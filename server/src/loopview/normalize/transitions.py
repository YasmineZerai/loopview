"""Derive transitions (control moving between steps) from timing and nesting.

No convention we support states "control went from A to B", so we derive it.
Only flow steps (agents, nodes, unknown) take part; model and tool calls are
details of the step that made them.

Within one scope (the steps directly inside the same agent, graph or node):

    A precedes B  when A ended before B started.
    A -> B        when A precedes B and no step C sits between them
                  (A precedes C and C precedes B).

That one rule covers every architecture:
- sequence:  A ends, B starts             -> A -> B
- parallel:  B1, B2, B3 overlap in time   -> none precedes another, so
             A -> B1, A -> B2, A -> B3 (fan out) and B1, B2, B3 -> C (fan in)
- loops:     A runs again later           -> an edge back to A's graph node
- handoffs:  agent X ends, agent Y starts -> X -> Y

Across scopes: the first steps in a scope get a `delegate` edge from the scope's
owner (a supervisor calling a worker, a graph entering its first node), and the
last steps a `return` edge back once the owner has finished.

A running step (no end yet) precedes nothing, so edges out of it appear once it ends.
"""

from loopview.normalize.schema import FLOW_KINDS, Step, Transition, TransitionKind


def derive_transitions(steps: list[Step]) -> list[Transition]:
    by_id = {s.id: s for s in steps}
    scopes: dict[str | None, list[Step]] = {}
    for step in steps:
        if not step.hidden and step.kind in FLOW_KINDS:
            scopes.setdefault(step.scope_id, []).append(step)

    transitions: list[Transition] = []
    for scope_id, members in scopes.items():
        members.sort(key=lambda s: (s.start_ns, s.id))
        edges = _immediate_predecessors(members)
        transitions += _label(edges, members)

        owner = by_id.get(scope_id) if scope_id else None
        if owner is None:
            continue
        has_incoming = {target for _, target in edges}
        has_outgoing = {source for source, _ in edges}
        for step in members:
            if step.id not in has_incoming:
                transitions.append(_transition(owner, step, "delegate"))
            if owner.end_ns is not None and step.end_ns is not None and step.id not in has_outgoing:
                transitions.append(_transition(step, owner, "return"))
    return transitions


def _precedes(a: Step, b: Step) -> bool:
    return a.end_ns is not None and a.end_ns <= b.start_ns and a.id != b.id


def _immediate_predecessors(members: list[Step]) -> list[tuple[str, str]]:
    """Edges of the "happens before" order with the implied (transitive) ones removed.

    O(n^2) per step in the worst case; scopes hold at most a few hundred steps.
    """
    edges = []
    for b in members:
        before = [a for a in members if _precedes(a, b)]
        for a in before:
            if not any(_precedes(a, c) for c in before):
                edges.append((a.id, b.id))
    return edges


def _label(edges: list[tuple[str, str]], members: list[Step]) -> list[Transition]:
    by_id = {s.id: s for s in members}
    # A graph node's position: when its key first appeared in this scope. An edge
    # to a node that appeared no later than the source is a loop (a back edge).
    first_seen: dict[str, int] = {}
    for index, step in enumerate(members):
        first_seen.setdefault(step.key, index)
    out_degree: dict[str, int] = {}
    in_degree: dict[str, int] = {}
    for source, target in edges:
        out_degree[source] = out_degree.get(source, 0) + 1
        in_degree[target] = in_degree.get(target, 0) + 1

    result = []
    for source_id, target_id in edges:
        source, target = by_id[source_id], by_id[target_id]
        kind: TransitionKind
        if first_seen[target.key] <= first_seen[source.key]:
            kind = "loop"
        elif out_degree[source_id] > 1:
            kind = "fan_out"
        elif in_degree[target_id] > 1:
            kind = "fan_in"
        elif target.kind == "agent" and not target.synthetic:
            kind = "handoff"  # a synthetic tools group is a step of the loop, not an agent
        else:
            kind = "sequence"
        result.append(_transition(source, target, kind))
    return result


def _transition(source: Step, target: Step, kind: TransitionKind) -> Transition:
    return Transition(id=f"{source.id}>{target.id}", source=source.id, target=target.id, kind=kind)
