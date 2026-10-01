"""Transition derivation on small synthetic runs, one per architecture shape.

Times are in arbitrary units; each helper call creates one flow step."""

from collections import Counter

from loopview.normalize.schema import Step
from loopview.normalize.transitions import derive_transitions


def step(
    id: str,
    start: int,
    end: int | None,
    scope: str | None = "g",
    name: str | None = None,
    kind: str = "node",
) -> Step:
    name = name or id.rstrip("0123456789")
    return Step(
        id=id,
        run_id="r",
        parent_id=scope,
        scope_id=scope,
        kind=kind,  # type: ignore[arg-type]
        type_label=kind,
        name=name,
        key=f"{scope}/{name}",
        start_ns=start,
        end_ns=end,
        status="ok" if end is not None else "running",
        convention="test",
    )


GRAPH = step("g", 0, 1000, scope=None, name="g", kind="agent")


def edges(*steps: Step) -> Counter[tuple[str, str, str]]:
    return Counter((t.kind, t.source, t.target) for t in derive_transitions([GRAPH, *steps]))


def test_sequence() -> None:
    e = edges(step("a", 0, 10), step("b", 10, 20), step("c", 25, 30))
    assert e[("sequence", "a", "b")] == 1 and e[("sequence", "b", "c")] == 1
    assert e[("delegate", "g", "a")] == 1 and e[("return", "c", "g")] == 1
    assert ("sequence", "a", "c") not in e  # implied by a -> b -> c


def test_loop_is_an_edge_back_to_an_earlier_node() -> None:
    e = edges(
        step("agent1", 0, 10),
        step("tools1", 10, 20),
        step("agent2", 20, 30),
        step("tools2", 30, 40),
        step("agent3", 40, 50),
    )
    assert e[("sequence", "agent1", "tools1")] == 1
    assert e[("loop", "tools1", "agent2")] == 1
    assert e[("loop", "tools2", "agent3")] == 1
    # agent -> tools the second time: tools was first seen after agent, so it's forward.
    assert e[("sequence", "agent2", "tools2")] == 1


def test_parallel_branches_fan_out_and_in() -> None:
    e = edges(
        step("plan", 0, 10),
        step("x", 11, 50),
        step("y", 12, 30),
        step("z", 12, 40),
        step("merge", 51, 60),
    )
    for branch in ("x", "y", "z"):
        assert e[("fan_out", "plan", branch)] == 1
        assert e[("fan_in", branch, "merge")] == 1
    assert not any(src in "xyz" and dst in "xyz" for _, src, dst in e)


def test_uneven_parallel_branches() -> None:
    # b and c start together; d starts when b ends, while c is still running.
    e = edges(
        step("a", 0, 10), step("b", 10, 20), step("c", 10, 40), step("d", 20, 30), step("e", 40, 50)
    )
    assert e[("fan_out", "a", "b")] == 1 and e[("fan_out", "a", "c")] == 1
    assert e[("sequence", "b", "d")] == 1
    assert e[("fan_in", "c", "e")] == 1 and e[("fan_in", "d", "e")] == 1


def test_handoff_between_agents() -> None:
    e = edges(step("triage", 0, 10, kind="agent"), step("billing", 10, 20, kind="agent"))
    assert e[("handoff", "triage", "billing")] == 1


def test_nested_agents_delegate_and_return() -> None:
    sup = step("sup", 0, 100, kind="agent")
    w1 = step("w1", 10, 50, scope="sup", name="worker_a", kind="agent")
    w2 = step("w2", 10, 60, scope="sup", name="worker_b", kind="agent")
    e = edges(sup, w1, w2)
    assert e[("delegate", "sup", "w1")] == 1 and e[("delegate", "sup", "w2")] == 1
    assert e[("return", "w1", "sup")] == 1 and e[("return", "w2", "sup")] == 1


def test_running_steps_have_no_outgoing_edges_yet() -> None:
    running_graph = step("g", 0, None, scope=None, name="g", kind="agent")
    transitions = derive_transitions([running_graph, step("a", 0, 10), step("b", 10, None)])
    kinds = Counter((t.kind, t.source, t.target) for t in transitions)
    assert kinds[("sequence", "a", "b")] == 1
    assert not any(t.source == "b" for t in transitions)
    assert not any(t.kind == "return" for t in transitions)  # the graph hasn't ended


def test_equal_timestamps_are_sequential_not_parallel() -> None:
    # Coarse clocks (Windows) can give b.start == a.end exactly.
    e = edges(step("a", 5, 5), step("b", 5, 9))
    assert e[("sequence", "a", "b")] == 1


def test_hidden_and_non_flow_steps_are_ignored() -> None:
    hidden = step("h", 10, 20)
    hidden.hidden = True
    tool = step("t", 10, 20, kind="tool_call")
    e = edges(step("a", 0, 10), hidden, tool, step("b", 20, 30))
    assert e[("sequence", "a", "b")] == 1
    assert not any("h" in (s, d) or "t" in (s, d) for _, s, d in e)
