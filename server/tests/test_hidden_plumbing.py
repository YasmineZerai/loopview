"""Spans that are kept but not drawn: MCP session housekeeping, and the app's own
span around an agent (D55). Recorded with the real OpenTelemetry SDK, shaped like
a Pydantic AI agent on an MCP server (mcp-python-sdk and fastmcp spans)."""

import pytest
from opentelemetry.trace import Tracer

from loopview.ingest.otlp import decode_body
from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import NormalizedRun
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore
from tests.helpers import record_spans, to_protobuf
from tests.test_normalize_fixtures import FIXTURES


def _agent_on_mcp(tracer: Tracer, wrapped: bool = True, fail: bool = False) -> None:
    def agent() -> None:
        with tracer.start_as_current_span(
            "invoke_agent single",
            attributes={"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "single"},
        ):
            if fail:  # the MCP server can't be reached, as on a lost connection
                raise RuntimeError("Client failed to connect: [Errno 11001] getaddrinfo failed")
            for method in ("server/discover", "initialize"):
                with tracer.start_as_current_span(
                    f"MCP send {method}", attributes={"mcp.method.name": method}
                ):
                    pass
            with tracer.start_as_current_span(
                "tools/list", attributes={"mcp.method.name": "tools/list"}
            ):
                with tracer.start_as_current_span(
                    "MCP send tools/list", attributes={"mcp.method.name": "tools/list"}
                ):
                    pass
            with tracer.start_as_current_span(
                "chat claude", attributes={"gen_ai.operation.name": "chat"}
            ):
                pass
            with tracer.start_as_current_span(
                "execute_tool search_code",
                attributes={
                    "gen_ai.operation.name": "execute_tool",
                    "gen_ai.tool.name": "search_code",
                },
            ):
                with tracer.start_as_current_span(
                    "tools/call search_code", attributes={"mcp.method.name": "tools/call"}
                ):
                    pass

    if wrapped:
        with tracer.start_as_current_span("triage org/repo#12", attributes={"app.issue": "12"}):
            try:
                agent()
            except RuntimeError:
                pass  # the app logs it and moves on to the next issue: its span ends unset
    else:
        agent()


def _normalize(wrapped: bool = True, fail: bool = False) -> NormalizedRun:
    spans = record_spans(lambda tracer: _agent_on_mcp(tracer, wrapped, fail))
    store = TraceStore()
    store.add_spans(decode_body(to_protobuf(spans), "application/x-protobuf"), 0)
    [run] = store.runs()
    return normalize_run(run, now_ns=run.last_received_ns)


def test_mcp_session_housekeeping_is_kept_but_not_drawn() -> None:
    steps = _normalize().steps
    mcp = [s for s in steps if s.name.startswith("MCP send") or s.name.startswith("tools/")]
    assert len(mcp) == 5 and all(s.hidden for s in mcp)  # nothing is dropped
    drawn = {s.name for s in steps if not s.hidden and not s.synthetic}
    assert drawn == {"single", "chat claude", "search_code"}


def test_the_apps_span_around_an_agent_is_the_run_not_a_card() -> None:
    n = _normalize()
    [triage] = [s for s in n.steps if s.name == "triage org/repo#12"]
    assert triage.hidden and triage.attributes["app.issue"] == "12"
    [agent] = [s for s in n.steps if s.kind == "agent" and not s.synthetic]
    assert agent.parent_id is None  # drawn at the top, not inside a detached card
    assert n.run.name == "triage org/repo#12"


def test_a_run_whose_wrapped_agent_failed_is_marked_failed() -> None:
    # The app caught the error, so its own span ends without a status; the run
    # must still not show a green check.
    assert _normalize(fail=True).run.status == "error"
    assert _normalize().run.status == "ok"


def test_without_the_apps_span_the_agent_is_the_run() -> None:
    n = _normalize(wrapped=False)
    assert n.run.name == "single"
    assert {s.name for s in n.steps if not s.hidden and not s.synthetic} == {
        "single",
        "chat claude",
        "search_code",
    }


@pytest.mark.parametrize("fixture", sorted(p.name for p in FIXTURES.glob("*.otlp.jsonl")))
def test_no_recorded_integration_draws_an_unknown_card(fixture: str) -> None:
    """Every card is an agent, a node, a model call or a tool call. The failing
    tools example drew MCP housekeeping as cards until D55, and no test said so."""
    store = TraceStore()
    load_capture(store, FIXTURES / fixture)
    for run in store.runs():
        steps = normalize_run(run, now_ns=run.last_received_ns).steps
        assert [s.name for s in steps if s.kind == "unknown" and not s.hidden] == []
