"""Every adapter against every fixture. Fixtures are real framework output
captured with examples/capture.py; see fixtures/README.md."""

from collections import Counter
from pathlib import Path

import pytest

from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import NormalizedRun, Step
from loopview.store.capture import load_capture
from loopview.store.memory import Run, TraceStore

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
ALL = ["react_anthropic", "langgraph_router", "multi_agent_pydantic", "flagship"]


def load_run(name: str) -> Run:
    store = TraceStore()
    load_capture(store, FIXTURES / f"{name}.otlp.jsonl")
    [run] = store.runs()
    return run


def normalized(name: str) -> NormalizedRun:
    run = load_run(name)
    return normalize_run(run, now_ns=run.last_received_ns)


def visible(n: NormalizedRun, kind: str | None = None) -> list[Step]:
    return [s for s in n.steps if not s.hidden and (kind is None or s.kind == kind)]


def edges(n: NormalizedRun) -> Counter[tuple[str, str, str]]:
    key = {s.id: s.key for s in n.steps}
    return Counter((t.kind, key[t.source], key[t.target]) for t in n.transitions)


@pytest.mark.parametrize("name", ALL)
def test_every_span_becomes_exactly_one_step(name: str) -> None:
    run = load_run(name)
    n = normalize_run(run, now_ns=run.last_received_ns)
    # Nothing dropped; the only steps without a span are the model and tools nodes
    # of a flat agent loop (loop_nodes.py).
    assert {s.id for s in n.steps if not s.synthetic} == set(run.spans)
    assert all(s.name in ("model", "tools") for s in n.steps if s.synthetic)
    assert n.run.status == "ok"
    assert all(not s.inferred for s in n.steps)


@pytest.mark.parametrize("name", ALL)
def test_transitions_only_connect_visible_flow_steps(name: str) -> None:
    n = normalized(name)
    flow = {s.id for s in visible(n) if s.kind in ("agent", "node", "unknown")}
    for t in n.transitions:
        assert t.source in flow and t.target in flow


# --- GenAI, hand instrumented (Anthropic SDK) ---------------------------------------


def test_react_anthropic_single_agent() -> None:
    n = normalized("react_anthropic")
    [agent] = visible(n, "agent")
    assert agent.name == "trip_budget_agent" and agent.convention == "gen_ai"

    calls = visible(n, "model_call")
    assert len(calls) >= 2  # the exact count depends on the model's choices
    first = calls[0].model
    assert first is not None and first.provider == "anthropic"
    assert first.input[0].role == "system" and first.input[1].role == "user"
    assert first.usage and first.usage.input_tokens and first.usage.output_tokens
    assert any(p.type == "tool_call" for m in first.output for p in m.parts)
    # Extended thinking, recorded as GenAI reasoning parts.
    assert first.output[0].parts[0].type == "reasoning" and first.output[0].parts[0].text

    tools = visible(n, "tool_call")
    assert [t.name for t in tools].count("hotel_price") == 2
    hotel = next(t for t in tools if t.name == "hotel_price").tool
    assert hotel is not None and "city" in hotel.arguments and "eur_per_night" in hotel.result
    # No span marks the model and tools steps of this loop, so they are added:
    # each tool call sits in the `tools` step of the turn that asked for it.
    by_id = {s.id: s for s in n.steps}
    for t in tools:
        holder = by_id[t.scope_id]  # type: ignore[index]
        assert holder.synthetic and holder.name == "tools" and holder.scope_id == agent.id
        assert t.parent_id == holder.id
    assert all(by_id[c.scope_id].name == "model" for c in calls)  # type: ignore[index]
    e = edges(n)
    assert e[("sequence", "trip_budget_agent/model", "trip_budget_agent/tools")] == 3
    assert e[("loop", "trip_budget_agent/tools", "trip_budget_agent/model")] == 3


# --- GenAI, native (Pydantic AI multi-agent) ------------------------------------------


def test_multi_agent_nested_parallel_and_handoff() -> None:
    n = normalized("multi_agent_pydantic")
    assert n.run.name == "laptop_advice"
    # Each Pydantic AI agent run has its own conversation id; the run's session is
    # the outermost one (the coordinator's), not a researcher's.
    run = load_run("multi_agent_pydantic")
    coordinator = next(s for s in run.spans.values() if s.name == "invoke_agent coordinator")
    assert n.run.session_id == coordinator.attributes["gen_ai.conversation.id"]

    agents = {s.name: s for s in visible(n, "agent") if not s.synthetic}
    assert set(agents) == {
        "laptop_advice",
        "coordinator",
        "specs_researcher",
        "reviews_researcher",
        "writer",
    }
    assert agents["laptop_advice"].type_label == "workflow"
    # Researchers run inside the coordinator's gather_facts tool: their visible parent
    # is the tool call, their scope is the coordinator's `tools` step for that turn,
    # which holds them and so is a group.
    gather = next(s for s in visible(n, "tool_call") if s.name == "gather_facts")
    tools_step = next(s for s in n.steps if s.id == gather.scope_id)
    assert tools_step.synthetic and tools_step.kind == "agent"
    assert tools_step.scope_id == agents["coordinator"].id
    for name in ("specs_researcher", "reviews_researcher"):
        assert agents[name].parent_id == gather.id
        assert agents[name].scope_id == tools_step.id

    e = edges(n)
    coordinator_key = "laptop_advice/coordinator"
    assert e[("handoff", coordinator_key, "laptop_advice/writer")] == 1
    # The coordinator's loop: model -> tools (a step of the loop, not a handoff) -> model.
    assert e[("sequence", f"{coordinator_key}/model", f"{coordinator_key}/tools")] == 1
    assert e[("loop", f"{coordinator_key}/tools", f"{coordinator_key}/model")] == 1
    for name in ("specs_researcher", "reviews_researcher"):
        key = f"{coordinator_key}/tools/{name}"
        assert e[("delegate", f"{coordinator_key}/tools", key)] == 1
        assert e[("return", key, f"{coordinator_key}/tools")] == 1
    # The writer makes no tool calls: no loop to show, so it stays one card.
    assert not any(s.synthetic and s.scope_id == agents["writer"].id for s in n.steps)


# --- OpenInference (LangGraph) ----------------------------------------------------


def test_langgraph_router_nodes_and_loops() -> None:
    n = normalized("langgraph_router")
    [graph] = visible(n, "agent")
    assert graph.type_label == "graph" and graph.convention == "openinference"

    nodes = Counter(s.name for s in visible(n, "node"))
    assert nodes == {"classify": 1, "agent": 4, "tools": 2, "review": 2}
    # Routing functions are kept but hidden.
    hidden = {s.name for s in n.steps if s.hidden}
    assert {"after_classify", "tools_condition", "after_review"} <= hidden

    e = edges(n)
    assert e[("sequence", "LangGraph/classify", "LangGraph/agent")] == 1
    assert e[("loop", "LangGraph/tools", "LangGraph/agent")] == 2
    assert e[("loop", "LangGraph/review", "LangGraph/agent")] == 1
    assert e[("delegate", "LangGraph", "LangGraph/classify")] == 1


def test_langgraph_model_call_messages_and_tools() -> None:
    n = normalized("langgraph_router")
    call = next(
        s
        for s in visible(n, "model_call")
        if any(p.type == "tool_call" for m in s.model.output for p in m.parts)
    )  # type: ignore[union-attr]
    assert call.model is not None
    assert (
        call.model.provider == "anthropic" and call.model.usage and call.model.usage.output_tokens
    )
    tool_part = next(p for m in call.model.output for p in m.parts if p.type == "tool_call")
    assert tool_part.name and isinstance(tool_part.arguments, dict)

    weekday = next(s for s in visible(n, "tool_call") if s.name == "weekday")
    assert weekday.tool is not None and weekday.tool.result in {
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    }


def test_flagship_every_feature() -> None:
    n = normalized("flagship")
    agents = {s.name for s in visible(n, "agent")}
    assert agents == {
        "database_comparison",
        "benchmarks_analyst",
        "operations_analyst",
        "ecosystem_analyst",
        "writer",
    }
    # The subgraph span directly inside each analyst node is collapsed into it.
    assert all(s.hidden for s in n.steps if s.name == "benchmarks_analyst" and s.kind != "agent")

    e = edges(n)
    root = "database_comparison"
    analysts = ["benchmarks_analyst", "operations_analyst", "ecosystem_analyst"]
    for a in analysts:
        assert e[("fan_out", f"{root}/supervisor", f"{root}/{a}")] == 1
        assert e[("fan_in", f"{root}/{a}", f"{root}/synthesize")] == 1
    assert e[("loop", f"{root}/critic", f"{root}/synthesize")] == 1
    assert e[("handoff", f"{root}/critic", f"{root}/writer")] == 1

    # Thinking is recovered from the raw output: OpenInference's flattened
    # message attributes drop it.
    thoughts = [
        p
        for s in visible(n, "model_call")
        for m in s.model.output  # type: ignore[union-attr]
        for p in m.parts
        if p.type == "reasoning"
    ]
    assert len(thoughts) >= 5 and all(p.text for p in thoughts)

    failed = [s for s in visible(n, "tool_call") if s.status == "error"]
    assert [s.name for s in failed] == ["fetch_repo_stats"]
    assert failed[0].error and "timed out" in failed[0].error
    retries = [s for s in visible(n, "tool_call") if s.name == "fetch_repo_stats"]
    assert sum(s.status == "ok" for s in retries) >= 1  # the retry succeeded


# --- liveness: replaying a fixture request by request ---------------------------------


@pytest.mark.parametrize("name", ["flagship", "multi_agent_pydantic"])
def test_partial_runs_show_running_parents(name: str) -> None:
    """Before the root span arrives, the run is running and its missing ancestors
    appear as inferred running steps, named from their children when possible."""
    from loopview.ingest.otlp import decode_body
    from loopview.store.capture import read_capture

    requests = list(read_capture(FIXTURES / f"{name}.otlp.jsonl"))
    store = TraceStore()
    for request in requests[: len(requests) // 2]:
        store.add_spans(decode_body(request.body, request.content_type), request.received_at_ns)
    [run] = store.runs()
    n = normalize_run(run, now_ns=run.last_received_ns)

    assert n.run.status == "running"
    inferred = [s for s in n.steps if s.inferred]
    assert inferred and all(s.status == "running" and s.end_ns is None for s in inferred)
    assert any(s.type_label != "running" for s in inferred)  # a real name was inferred
    # Everything hangs under one provisional root while the real one is missing.
    assert sum(s.parent_id is None for s in n.steps) == 1

    # Much later with nothing new, the run is considered finished.
    later = normalize_run(run, now_ns=run.last_received_ns + 10**12)
    assert later.run.status == "ok"
    assert all(s.status != "running" for s in later.steps)
