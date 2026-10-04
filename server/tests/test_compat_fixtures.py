"""What loopview makes of each integration, from real recordings (examples/compat).

Every compat agent runs the same task: two cities, so two turns of tool calls, and
Atlantis fails. A plain SDK loop is recorded as is (every model call a run of its
own) and `_wrapped` in loopview_sdk.agent (one run).
"""

from pathlib import Path

import pytest

from loopview.normalize.derived_tools import derive_tool_calls
from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import Message, MessagePart, ModelCall, NormalizedRun, Step
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore
from loopview.tools.report import tools_report

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PLAIN_SDK = [
    "openai_sdk_openinference",
    "openai_sdk_otel",
    "anthropic_sdk_openinference",
    "anthropic_sdk_openllmetry",
]


def runs(name: str) -> list[NormalizedRun]:
    store = TraceStore()
    load_capture(store, FIXTURES / f"{name}.otlp.jsonl")
    return [normalize_run(r, now_ns=r.last_received_ns) for r in store.runs()]


def visible(n: NormalizedRun, kind: str) -> list[Step]:
    return [s for s in n.steps if not s.hidden and s.kind == kind]


@pytest.mark.parametrize("name", PLAIN_SDK)
def test_a_wrapped_plain_sdk_loop_is_one_agent_with_its_loop(name: str) -> None:
    [n] = runs(f"{name}_wrapped")
    [agent] = [s for s in visible(n, "agent") if not s.synthetic]
    assert agent.name == "weather_assistant"
    # No span records the user's tools; they are rebuilt from the conversation.
    tools = visible(n, "tool_call")
    assert sorted(t.name for t in tools) == ["get_weather", "get_weather", "to_fahrenheit"]
    assert all(t.synthetic for t in tools)
    weather = {t.tool.arguments["city"]: t for t in tools if t.name == "get_weather"}  # type: ignore[index,union-attr]
    assert weather["Lisbon"].tool.result == {"city": "lisbon", "celsius": 21.0}  # type: ignore[union-attr]
    assert "Atlantis" in str(weather["Atlantis"].tool.result)  # type: ignore[union-attr]
    # Drawn as a loop, like a framework's.
    names = {(t.kind, by_key(n, t.source), by_key(n, t.target)) for t in n.transitions}
    assert ("sequence", "weather_assistant/model", "weather_assistant/tools") in names
    assert ("loop", "weather_assistant/tools", "weather_assistant/model") in names
    report = tools_report([n])
    assert report["summary"]["tool_calls"] == 3 and report["never_called"] == []


def by_key(n: NormalizedRun, step_id: str) -> str:
    return next(s.key for s in n.steps if s.id == step_id)


def test_tool_errors_are_kept_only_where_the_trace_flags_them() -> None:
    """Anthropic flags a failed tool result (is_error); OpenInference's Anthropic
    instrumentation keeps the flag in the raw request. Elsewhere there is no flag,
    and the text "error: ..." is not taken as one."""
    failed = {
        name: [
            t.tool.arguments["city"]
            for t in visible(runs(f"{name}_wrapped")[0], "tool_call")
            if t.status == "error"
        ]  # type: ignore[index,union-attr]
        for name in PLAIN_SDK
    }
    assert failed == {
        "anthropic_sdk_openinference": ["Atlantis"],
        "anthropic_sdk_openllmetry": [],
        "openai_sdk_openinference": [],
        "openai_sdk_otel": [],
    }


@pytest.mark.parametrize("name", PLAIN_SDK)
def test_an_unwrapped_loop_is_a_run_per_model_call_but_never_empty(name: str) -> None:
    recorded = runs(name)
    assert len(recorded) == 3  # nothing ties the calls together without a span
    for n in recorded:
        # A synthetic agent holds the call, so the graph has something to draw.
        [agent] = visible(n, "agent")
        assert agent.synthetic and agent.name == name  # the service name
        assert all(c.scope_id is not None for c in visible(n, "model_call"))
    # The tools asked for are still counted, so none is reported as never called.
    report = tools_report(recorded)
    assert report["summary"]["tool_calls"] == 3 and report["never_called"] == []


def test_openinference_anthropic_keeps_every_tool_result() -> None:
    """Its flattened messages keep one tool result per message; the raw request has both."""
    [n] = runs("anthropic_sdk_openinference_wrapped")
    second = visible(n, "model_call")[1].model
    results = [p for m in second.input for p in m.parts if p.type == "tool_result"]  # type: ignore[union-attr]
    assert len(results) == 2
    assert sorted(bool(r.is_error) for r in results) == [False, True]
    # A tool_use block repeats a tool call; it isn't kept as a part of its own.
    assert all(p.type != "other" for m in second.output for p in m.parts)  # type: ignore[union-attr]


def test_openai_agents_sdk() -> None:
    [n] = runs("openai_agents_sdk")
    agents = [s.name for s in visible(n, "agent")]
    assert agents == ["Agent workflow", "weather_assistant"]  # the CHAIN copy is folded
    tools = visible(n, "tool_call")
    assert len(tools) == 3 and not any(t.synthetic for t in tools)  # recorded for real
    assert [t.tool.arguments for t in tools if t.status == "error"] == [{"city": "Atlantis"}]  # type: ignore[union-attr]
    calls = visible(n, "model_call")
    # The model is "anthropic/claude-haiku-...": priced as the provider's model.
    assert all(c.model and c.model.cost and c.model.cost.dollars for c in calls)


# --- the rebuild on its own ----------------------------------------------------------------


def call(id: str, start: int, end: int, out: list[MessagePart], inp: list[MessagePart]) -> Step:
    return Step(
        id=id,
        run_id="r",
        parent_id="a",
        scope_id="a",
        kind="model_call",
        type_label="llm",
        name="m",
        key="a/model_call:m",
        status="ok",
        start_ns=start,
        end_ns=end,
        convention="gen_ai",
        model=ModelCall(
            input=[Message(role="user", parts=inp)], output=[Message(role="assistant", parts=out)]
        ),
    )


def test_rebuilt_calls_span_the_gap_between_model_calls() -> None:
    ask = MessagePart(type="tool_call", id="t1", name="search", arguments={"q": "x"})
    answer = MessagePart(type="tool_result", id="t1", result="found", is_error=None)
    steps = derive_tool_calls([call("m1", 0, 10, [ask], []), call("m2", 25, 30, [], [answer])])
    [tool] = [s for s in steps if s.kind == "tool_call"]
    assert (tool.start_ns, tool.end_ns, tool.status, tool.scope_id) == (10, 25, "ok", "a")
    assert tool.tool.result == "found" and tool.synthetic  # type: ignore[union-attr]


def test_unanswered_requests_last_no_time_and_runs_with_tool_spans_are_left_alone() -> None:
    ask = MessagePart(type="tool_call", id="t1", name="search")
    [_, tool] = derive_tool_calls([call("m1", 0, 10, [ask], [])])
    assert (tool.start_ns, tool.end_ns, tool.tool.result) == (10, 10, None)  # type: ignore[union-attr]
    real = Step(
        id="t",
        run_id="r",
        parent_id="a",
        scope_id="a",
        kind="tool_call",
        type_label="tool",
        name="search",
        key="k",
        status="ok",
        start_ns=11,
        end_ns=12,
        convention="gen_ai",
    )
    steps = [call("m1", 0, 10, [ask], []), real]
    assert derive_tool_calls(steps) == steps


def test_crewai_through_connect() -> None:
    """CrewAI with loopview_sdk.connect(): CrewAI's own instrumentation records the
    crew, agent and tools; its model calls go through an Anthropic SDK too old for
    OpenInference's instrumentor, so connect() used OpenLLMetry's."""
    [n] = runs("crewai")
    assert [s.name for s in visible(n, "agent") if not s.synthetic] == [
        "Crew.kickoff",  # was "Crew_<uuid>.kickoff"
        "Weather assistant",  # was "Weather assistant._execute_core"
    ]
    calls = visible(n, "model_call")
    assert len(calls) == 3 and all(c.model and c.model.cost and c.model.cost.dollars for c in calls)
    tools = visible(n, "tool_call")
    assert len(tools) == 3 and not any(t.synthetic for t in tools)
    assert [t.status for t in tools if t.name == "get_weather"].count("error") == 1
    keys = {s.key for s in n.steps if s.synthetic}
    assert {"Crew.kickoff/Weather assistant/model", "Crew.kickoff/Weather assistant/tools"} <= keys
