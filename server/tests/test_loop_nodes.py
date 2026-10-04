"""The model and tools nodes added to flat agent loops (normalize/loop_nodes.py)."""

from typing import Any

from loopview.normalize.loop_nodes import add_loop_nodes
from loopview.normalize.schema import Step, ToolCall
from loopview.normalize.transitions import derive_transitions


def step(
    id: str, kind: str, start: int, end: int | None, scope: str | None = "a", **f: Any
) -> Step:
    name = f.pop("name", kind)
    return Step(
        id=id,
        run_id="r",
        parent_id=scope,
        scope_id=scope,
        kind=kind,
        type_label=kind,
        name=name,
        key=name,
        status=f.pop("status", "ok"),
        start_ns=start,
        end_ns=end,
        convention="gen_ai",
        **f,
    )


def agent() -> Step:
    return step("a", "agent", 0, 100, scope=None, name="agent")


def tool(id: str, start: int, end: int | None, name: str = "search") -> Step:
    return step(id, "tool_call", start, end, name=name, tool=ToolCall(name=name))


def by_name(steps: list[Step]) -> dict[str, list[Step]]:
    out: dict[str, list[Step]] = {}
    for s in steps:
        out.setdefault(s.name, []).append(s)
    return out


def test_a_turn_groups_the_tools_its_model_call_asked_for() -> None:
    # Timestamps tie on purpose: tools start the moment the model call ends.
    steps = add_loop_nodes(
        [
            agent(),
            step("m1", "model_call", 0, 10),
            tool("t1", 10, 12),
            tool("t2", 10, 15, "fetch"),
            step("m2", "model_call", 15, 20),
            tool("t3", 20, 21),
            step("m3", "model_call", 21, 30),
        ]
    )
    s = by_name(steps)
    assert len(s["model"]) == 3 and len(s["tools"]) == 2
    first_tools = next(x for x in s["tools"] if x.id == "m1~tools")
    assert (first_tools.start_ns, first_tools.end_ns) == (10, 15)
    held = {x.id: x.scope_id for x in steps if x.kind == "tool_call"}
    assert held == {"t1": "m1~tools", "t2": "m1~tools", "t3": "m2~tools"}
    assert all(x.key == f"agent/{x.name}" for x in steps if x.synthetic)
    tool_keys = {x.key for x in steps if x.kind == "tool_call"}
    assert tool_keys == {"agent/tools/tool_call:search", "agent/tools/tool_call:fetch"}

    flow = sorted(
        (t.kind, t.source, t.target)
        for t in derive_transitions(steps)
        if t.kind in ("sequence", "loop")
    )
    assert flow == [
        ("loop", "m1~tools", "m2~model"),
        ("loop", "m2~tools", "m3~model"),
        ("sequence", "m1~model", "m1~tools"),
        ("sequence", "m2~model", "m2~tools"),
    ]


def test_agents_without_tool_calls_are_left_alone() -> None:
    steps = [agent(), step("m1", "model_call", 0, 10), step("m2", "model_call", 10, 20)]
    assert add_loop_nodes(list(steps)) == steps


def test_running_calls_and_tools_before_any_model_call() -> None:
    steps = add_loop_nodes([agent(), tool("t0", 0, 1), step("m1", "model_call", 2, None)])
    s = by_name(steps)
    assert s["tools"][0].id == "a~tools"  # no model call before it
    assert s["model"][0].status == "running" and s["model"][0].end_ns is None


def test_a_sub_agent_run_by_a_tool_moves_into_the_tools_group() -> None:
    sub = step("sub", "agent", 11, 14, name="researcher")
    sub.parent_id = "t1"  # visible parent: the tool call that ran it
    inner = step("sm", "model_call", 11, 13, scope="sub")
    steps = add_loop_nodes(
        [agent(), step("m1", "model_call", 0, 10), tool("t1", 10, 15), sub, inner]
    )
    tools = next(x for x in steps if x.name == "tools")
    assert tools.kind == "agent"  # it holds a flow step now: a group
    assert sub.scope_id == tools.id and sub.key == "agent/tools/researcher"
    assert inner.scope_id == "sub"  # the sub-agent's own calls stay with it
    assert inner.key == "agent/tools/researcher/model_call:model_call"
