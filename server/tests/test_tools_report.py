"""The Tools tab report: next moves, error groups, confused pairs, offered tools.
Synthetic runs cover each case; the recorded fixtures check real framework output."""

from pathlib import Path
from typing import Any

import pytest

from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import ModelCall, NormalizedRun, RunInfo, Step, ToolCall
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore
from loopview.tools.report import canonical_args, definition_name, error_group, tools_report

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


# --- building synthetic runs ------------------------------------------------------------


class RunBuilder:
    """One agent's loop, turn by turn: a model call, then the tools it requested.
    Timestamps are in steps of 10 and tie on purpose: each tool starts exactly
    when its model call ends, as on a coarse clock."""

    def __init__(self, run_id: str = "run1", agent: str = "agent", tools: list[str] | None = None):
        self.run_id, self.t, self.n = run_id, 0, 0
        self.definitions = [_definition(name) for name in tools or []]
        self.steps = [self._step("agent", agent, None)]
        self.agent_id = self.steps[0].id

    def _step(self, kind: str, name: str, parent: str | None, **fields: Any) -> Step:
        self.n += 1
        return Step(
            id=f"{self.run_id}-s{self.n}",
            run_id=self.run_id,
            parent_id=parent,
            scope_id=parent,
            kind=kind,
            type_label=kind,
            name=name,
            key=name,
            status=fields.pop("status", "ok"),
            start_ns=fields.pop("start", 0),
            end_ns=fields.pop("end", 10_000),
            convention="gen_ai",
            **fields,
        )

    def turn(self, *calls: tuple[str, Any, str | None]) -> "RunBuilder":
        """A model call, then tool calls (name, arguments, error or None) in a row."""
        start, self.t = self.t, self.t + 10
        model = ModelCall(tool_definitions=self.definitions)
        self.steps.append(
            self._step("model_call", "m", self.agent_id, start=start, end=self.t, model=model)
        )
        for name, args, error in calls:
            start, self.t = self.t, self.t + 1
            self.steps.append(
                self._step(
                    "tool_call",
                    name,
                    self.agent_id,
                    start=start,
                    end=self.t,
                    status="error" if error else "ok",
                    error=error,
                    tool=ToolCall(name=name, arguments=args, result=None if error else "ok"),
                )
            )
        return self

    def build(self) -> NormalizedRun:
        info = RunInfo(
            id=self.run_id,
            name="r",
            service_name=None,
            session_id=None,
            status="ok",
            start_ns=0,
            end_ns=self.t,
            step_count=len(self.steps),
            last_received_ns=0,
        )
        return NormalizedRun(run=info, steps=self.steps, transitions=[])


def _definition(name: str) -> dict[str, Any]:
    return {"type": "function", "name": name, "description": "d" * 36, "parameters": {}}


def tool(report: dict[str, Any], name: str) -> dict[str, Any]:
    [entry] = [t for t in report["tools"] if t["name"] == name]
    return entry


def fixture_runs(name: str) -> list[NormalizedRun]:
    store = TraceStore()
    load_capture(store, FIXTURES / f"{name}.otlp.jsonl")
    return [normalize_run(run) for run in store.runs()]


# --- next move after an error ---------------------------------------------------------------


def test_blind_retry() -> None:
    run = RunBuilder().turn(("search", {"q": "x"}, "timeout")).turn(("search", {"q": "x"}, None))
    after = tool(tools_report([run.build()]), "search")["after_error"]
    assert after == {
        "blind_retry": 1,
        "fixed": 0,
        "fixed_succeeded": 0,
        "switched": 0,
        "gave_up": 0,
    }


def test_identical_arguments_compare_with_sorted_keys() -> None:
    assert canonical_args({"b": 1, "a": 2}) == canonical_args({"a": 2, "b": 1})
    run = RunBuilder().turn(("f", {"a": 1, "b": 2}, "boom")).turn(("f", {"b": 2, "a": 1}, None))
    assert tool(tools_report([run.build()]), "f")["after_error"]["blind_retry"] == 1


def test_fixed_records_whether_the_fix_worked() -> None:
    worked = RunBuilder("r1").turn(("f", {"id": 1}, "bad id")).turn(("f", {"id": 2}, None))
    failed = RunBuilder("r2").turn(("f", {"id": 1}, "bad id")).turn(("f", {"id": 3}, "bad id"))
    after = tool(tools_report([worked.build(), failed.build()]), "f")["after_error"]
    # r2's second failure is followed by nothing: gave up.
    assert (after["fixed"], after["fixed_succeeded"], after["gave_up"]) == (2, 1, 1)


def test_switched_and_gave_up() -> None:
    run = RunBuilder().turn(("get", {"k": 1}, "unknown")).turn(("find", {"n": "a"}, None))
    report = tools_report([run.build()])
    assert tool(report, "get")["after_error"]["switched"] == 1
    lonely = RunBuilder().turn(("get", {"k": 1}, "unknown")).turn()
    assert tool(tools_report([lonely.build()]), "get")["after_error"]["gave_up"] == 1


def test_calls_from_the_same_turn_are_not_a_reaction() -> None:
    """The model asked for both calls before it saw the error; the second one isn't
    a fix, even though it is the very next call."""
    run = (
        RunBuilder()
        .turn(("f", {"x": 1}, "boom"), ("f", {"x": 2}, None))
        .turn(("f", {"x": 1}, None))
    )
    assert tool(tools_report([run.build()]), "f")["after_error"]["blind_retry"] == 1


def test_retries_of_other_failures_in_the_turn_are_skipped() -> None:
    """Two tools fail together; the next turn retries `b` before switching away
    from `a`. a -> c is the switch, not a -> b."""
    run = (
        RunBuilder()
        .turn(("a", {}, "no"), ("b", {"v": 1}, "no"))
        .turn(("b", {"v": 2}, None), ("c", {}, None))
    )
    report = tools_report([run.build()])
    assert tool(report, "a")["after_error"]["switched"] == 1
    assert tool(report, "b")["after_error"]["fixed_succeeded"] == 1


def test_next_move_stays_within_the_agent() -> None:
    builder = RunBuilder().turn(("f", {}, "no"))
    other = builder._step("agent", "other", None)
    builder.steps.append(other)
    builder.steps.append(
        builder._step(
            "tool_call", "f", other.id, start=50, end=51, tool=ToolCall(name="f", arguments={})
        )
    )
    assert tool(tools_report([builder.build()]), "f")["after_error"]["gave_up"] == 1


def test_without_model_calls_the_next_tool_call_is_used() -> None:
    builder = RunBuilder()
    for i, (args, error) in enumerate([({"x": 1}, "no"), ({"x": 1}, None)]):
        builder.steps.append(
            builder._step(
                "tool_call",
                "f",
                builder.agent_id,
                start=i * 10,
                end=i * 10 + 5,
                status="error" if error else "ok",
                error=error,
                tool=ToolCall(name="f", arguments=args),
            )
        )
    report = tools_report([builder.build()])
    assert tool(report, "f")["after_error"]["blind_retry"] == 1
    assert report["tool_list_recorded"] is False


def test_mcp_is_error_result_counts_as_an_error() -> None:
    builder = RunBuilder().turn(("f", {}, None))
    builder.steps[-1].tool.result = {
        "isError": True,
        "content": [{"type": "text", "text": "nope 42"}],
    }
    entry = tool(tools_report([builder.build()]), "f")
    assert entry["errors"] == 1
    assert entry["top_errors"][0]["message_group"] == "nope <n>"


# --- groups, pairs, offered tools ---------------------------------------------------------------


def test_error_groups_replace_variable_parts() -> None:
    assert error_group("order 1234 not found") == "order <n> not found"
    assert error_group("id 3f2a9c1e-1d2b-4c3d-8e9f-0a1b2c3d4e5f gone") == "id <uuid> gone"
    assert error_group("commit 9fceb02d0ae598e9 missing, 0xFF") == "commit <id> missing, <id>"
    assert error_group("no file named 'src/very/long/path.py'") == "no file named <value>"
    assert error_group("no city 'Berlin'") == "no city 'Berlin'"  # short values stay
    assert len(error_group("x" * 500)) == 200


def test_top_errors_are_grouped_and_point_at_a_step() -> None:
    run = RunBuilder()
    for i in range(3):
        run.turn(("f", {"id": i}, f"order {i} not found"))
    run.turn(("f", {}, "rate limited"))
    entry = tool(tools_report([run.build()]), "f")
    first = entry["top_errors"][0]
    assert (first["message_group"], first["count"]) == ("order <n> not found", 3)
    assert first["example_args"] == {"id": 0} and first["example_message"] == "order 0 not found"
    assert first["step_ref"]["run_id"] == "run1"
    assert entry["error_rate"] == 1.0 and len(entry["step_refs"]) == 4


def test_confused_pairs_need_two_occurrences() -> None:
    runs = [
        RunBuilder(f"r{i}").turn(("get", {}, "no")).turn(("find", {}, None)).build()
        for i in range(2)
    ]
    once = RunBuilder("r9").turn(("get", {}, "no")).turn(("list", {}, None)).build()
    report = tools_report([*runs, once])
    assert tool(report, "get")["confused_with"] == [{"tool": "find", "count": 2}]


def test_never_called_tools_and_their_estimated_cost() -> None:
    runs = [
        RunBuilder(f"r{i}", tools=["used", "unused"]).turn(("used", {}, None)).turn().build()
        for i in range(2)
    ]
    report = tools_report(runs)
    per_definition = -(-len(canonical_args(_definition("unused"))) // 4)
    assert report["never_called"] == [
        {
            "name": "unused",
            "definition_tokens_estimate": per_definition * 4,
            "carried_by_model_calls": 4,
        }
    ]
    assert report["summary"]["never_called_count"] == 1
    assert report["summary"]["never_called_tokens_per_run_estimate"] == per_definition * 2


def test_tool_list_not_recorded_means_no_never_called() -> None:
    report = tools_report([RunBuilder().turn(("f", {}, None)).build()])
    assert report["tool_list_recorded"] is False
    assert report["never_called"] == [] and report["summary"]["never_called_count"] == 0


def test_summary_and_sort_order() -> None:
    run = (
        RunBuilder()
        .turn(("a", {}, "x"), ("b", {}, "y"), ("c", {}, "z"))
        .turn(("a", {"v": 1}, "x"), ("b", {"v": 1}, None))
        .turn()
    )
    report = tools_report([run.build()])
    assert [t["name"] for t in report["tools"]] == ["a", "b", "c"]
    s = report["summary"]
    assert (s["runs"], s["tool_calls"], s["errors"]) == (1, 5, 4)
    assert s["share_of_errors_from_top_2_tools"] == 0.75


def test_empty_input() -> None:
    report = tools_report([])
    assert report["tools"] == [] and report["summary"]["share_of_errors_from_top_2_tools"] is None


def test_definition_names_in_both_shapes() -> None:
    assert definition_name({"name": "a"}) == "a"
    assert definition_name({"type": "function", "function": {"name": "b"}}) == "b"
    assert definition_name("nope") is None


def test_results_are_averaged_over_successful_calls_only() -> None:
    run = RunBuilder().turn(("f", {}, None), ("f", {}, "boom"))
    run.steps[-2].tool.result = "x" * 40
    run.steps[-1].tool.result = "y" * 4000  # a retry prompt, as Pydantic AI records
    assert tool(tools_report([run.build()]), "f")["avg_result_tokens_estimate"] == 10


# --- recorded fixtures ------------------------------------------------------------


def test_flagship_retry_after_timeout_is_a_blind_retry() -> None:
    """LangGraph runs the analyst's three fetch_repo_stats calls in one turn; the
    PostgreSQL one times out and is asked again, with the same argument, later."""
    entry = tool(tools_report(fixture_runs("flagship")), "fetch_repo_stats")
    assert (entry["calls"], entry["errors"]) == (4, 1)
    assert entry["after_error"]["blind_retry"] == 1
    assert entry["top_errors"][0]["example_args"] == "PostgreSQL"


def test_pydantic_mcp_error_and_model_retry() -> None:
    report = tools_report(fixture_runs("failing_tools_pydantic"))
    get_stock, order_status = tool(report, "get_stock"), tool(report, "order_status")
    # MCP isError reaches the span as a ModelRetry; the model then looks the SKU up.
    assert get_stock["errors"] == 1 and get_stock["after_error"]["switched"] == 1
    assert "unknown sku 'SKU-<n>'" in get_stock["top_errors"][0]["message_group"]
    assert order_status["after_error"]["fixed_succeeded"] == 1
    assert report["tool_list_recorded"] and report["never_called"] == []


def test_anthropic_error_then_giving_up() -> None:
    report = tools_report(fixture_runs("failing_tool_anthropic"))
    assert tool(report, "hotel_price")["after_error"]["gave_up"] == 1
    assert {t["name"] for t in report["never_called"]} == {"calculator", "convert_currency"}


@pytest.mark.parametrize(
    "name", ["react_anthropic", "langgraph_router", "multi_agent_pydantic", "flagship"]
)
def test_every_fixture_records_its_tool_list(name: str) -> None:
    report = tools_report(fixture_runs(name))
    assert report["tool_list_recorded"]
    assert report["summary"]["tool_calls"] > 0


# --- the API ------------------------------------------------------------


def test_api_tools_all_runs_a_session_and_a_list() -> None:
    from fastapi.testclient import TestClient

    from loopview.app import create_app

    store = TraceStore()
    for name in ("failing_tools_pydantic", "failing_tool_anthropic"):
        load_capture(store, FIXTURES / f"{name}.otlp.jsonl")
    client = TestClient(create_app(store=store))

    everything = client.get("/api/tools").json()
    assert everything["summary"]["runs"] == 2 and everything["summary"]["errors"] == 3

    [session] = client.get("/api/sessions").json()  # only Pydantic AI sets one
    by_session = client.get("/api/tools", params={"session": session["session_id"]}).json()
    assert {t["name"] for t in by_session["tools"]} == {"get_stock", "order_status", "find_sku"}

    anthropic_run = next(r.trace_id for r in store.runs() if r.session_id is None)
    listed = client.get("/api/tools", params={"runs": anthropic_run}).json()
    assert [t["name"] for t in listed["tools"]] == ["hotel_price"]

    assert client.get("/api/tools", params={"session": "nope"}).status_code == 404
    assert client.get("/api/tools", params={"runs": "nope"}).status_code == 404


# --- the MCP tools study: 20 real runs against GitHub's MCP server ---------------------------


def test_mcp_study_fixture_normalizes_completely() -> None:
    """Every span of every run becomes one step, including FastMCP's own MCP spans."""
    store = TraceStore()
    load_capture(store, FIXTURES / "mcp_tools_study.otlp.jsonl")
    for run in store.runs():
        n = normalize_run(run, now_ns=run.last_received_ns)
        assert {s.id for s in n.steps} == set(run.spans)
        assert n.run.status == "ok"


def test_mcp_study_report() -> None:
    store = TraceStore()
    load_capture(store, FIXTURES / "mcp_tools_study.otlp.jsonl")
    # The study's 20 tasks share a session. The recording also has one run outside
    # it: the MCP connection, opened before the first task (fixed in the script since).
    [session] = store.sessions()
    assert len(session.trace_ids) == 20 and len(store.runs()) == 21
    runs = [normalize_run(store.get_run(t)) for t in session.trace_ids]  # type: ignore[arg-type]
    report = tools_report(runs)

    s = report["summary"]
    assert (s["runs"], s["tool_calls"], s["errors"]) == (20, 38, 2)
    assert report["tool_list_recorded"]
    # FastMCP's own `tools/call` spans are not counted as tool calls a second time.
    assert sum(t["calls"] for t in report["tools"]) == 38

    files = tool(report, "get_file_contents")
    assert (files["calls"], files["errors"], files["after_error"]["switched"]) == (10, 1, 1)
    assert "Failed to get file contents" in files["top_errors"][0]["message_group"]
    collaborators = tool(report, "list_repository_collaborators")
    assert collaborators["after_error"]["switched"] == 1

    never = {t["name"] for t in report["never_called"]}
    assert s["never_called_count"] == len(never) == 14
    assert {"get_me", "list_releases", "search_commits"} <= never
    assert all(t["definition_tokens_estimate"] > 0 for t in report["never_called"])
