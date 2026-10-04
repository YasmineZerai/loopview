"""Give a flat agent loop the shape of a graph: a `model` node and a `tools` node.

LangGraph records a span per graph node, so its agents arrive as `model` and
`tools` nodes with the calls inside them, and the graph shows the loop. The GenAI
conventions (Pydantic AI, the Anthropic and OpenAI SDKs, hand instrumented code)
record only `invoke_agent` with `chat` and `execute_tool` spans directly under it:
no span says "this is the model step" or "this is the tools step". Drawn as is,
such an agent is one card holding every call.

For an agent with tool calls directly inside it, this pass adds the steps the
convention leaves out, marked `synthetic`:
- one `model` step per model call, wrapping it;
- one `tools` step per turn, wrapping the tool calls that model call asked for.
  A tool call belongs to the agent's latest model call that had ended when the
  tool started (compared with ends, so tied timestamps work, DECISIONS D17).

The usual transition rule then draws model -> tools -> model, with a loop counter.
A flow step started by a tool (a sub-agent run by `gather_facts`) moves inside
that turn's `tools` step, which then becomes a group. Agents without direct tool
calls are left alone: with only model calls there is no loop to show.
"""

from loopview.normalize.schema import FLOW_KINDS, Step, StepStatus

CALL_KINDS = ("model_call", "tool_call")


def add_loop_nodes(steps: list[Step]) -> list[Step]:
    by_id = {s.id: s for s in steps}
    direct: dict[str, list[Step]] = {}  # agent id -> its visible direct calls
    for s in steps:
        owner = by_id.get(s.scope_id) if s.scope_id else None
        if owner and owner.kind == "agent" and not s.hidden and s.kind in CALL_KINDS:
            direct.setdefault(owner.id, []).append(s)

    added: list[Step] = []
    new_scope: dict[str, str] = {}  # call id -> the synthetic step that now holds it
    for agent_id, calls in direct.items():
        if not any(c.kind == "tool_call" for c in calls):
            continue
        agent = by_id[agent_id]
        models = sorted((c for c in calls if c.kind == "model_call"), key=_order)
        for m in models:
            step = _synthetic(agent, f"{m.id}~model", "model", [m])
            added.append(step)
            new_scope[m.id] = step.id
        turns: dict[int, list[Step]] = {}
        for t in sorted((c for c in calls if c.kind == "tool_call"), key=_order):
            turns.setdefault(_turn_of(t, models), []).append(t)
        for index, tools in turns.items():
            step_id = f"{models[index].id}~tools" if index >= 0 else f"{agent.id}~tools"
            step = _synthetic(agent, step_id, "tools", tools)
            added.append(step)
            for t in tools:
                new_scope[t.id] = step.id

    if not added:
        return steps
    all_steps = steps + added
    by_id.update({s.id: s for s in added})

    # Move the calls, and everything that happened inside them, into their new step.
    for s in steps:
        if s.id in new_scope:
            s.parent_id = s.scope_id = new_scope[s.id]
            continue
        inside = _enclosing_call(s, by_id, new_scope)
        if inside is not None:
            s.scope_id = new_scope[inside]

    # A tools step that now holds flow steps (sub-agents) is a group.
    for s in all_steps:
        if s.kind in FLOW_KINDS and not s.hidden and s.scope_id:
            holder = by_id[s.scope_id]
            if holder.synthetic and holder.kind == "node":
                holder.kind = "agent"

    _rekey(all_steps, by_id)
    all_steps.sort(key=_order)
    return all_steps


def _order(s: Step) -> tuple[int, str]:
    return (s.start_ns, s.id)


def _turn_of(call: Step, models: list[Step]) -> int:
    turn = -1
    for i, m in enumerate(models):
        if m.end_ns is not None and m.end_ns <= call.start_ns:
            turn = i
    return turn


def _synthetic(agent: Step, step_id: str, name: str, inside: list[Step]) -> Step:
    running = any(c.end_ns is None for c in inside)
    status: StepStatus = "running" if running else "ok"
    if name == "model" and not running:
        status = inside[0].status
    return Step(
        id=step_id,
        run_id=agent.run_id,
        parent_id=agent.id,
        scope_id=agent.id,
        kind="node",
        type_label=name,
        name=name,
        key="",  # set by _rekey
        status=status,
        start_ns=min(c.start_ns for c in inside),
        end_ns=None if running else max(c.end_ns or 0 for c in inside),
        convention=agent.convention,
        synthetic=True,
    )


def _enclosing_call(s: Step, by_id: dict[str, Step], moved: dict[str, str]) -> str | None:
    """The moved call that `s` happened inside, if any (walking visible parents)."""
    parent_id = s.parent_id
    while parent_id is not None and parent_id in by_id:
        if parent_id in moved:
            return parent_id
        parent = by_id[parent_id]
        if parent.kind in FLOW_KINDS:
            return None  # another flow step owns it
        parent_id = parent.parent_id
    return None


def _rekey(steps: list[Step], by_id: dict[str, Step]) -> None:
    """Keys are the scope path plus the name, as the normalizer builds them; scopes
    changed, so build them again."""
    keys: dict[str, str] = {}

    def key_of(step: Step) -> str:
        if step.id not in keys:
            name = step.name if step.kind in FLOW_KINDS else f"{step.kind}:{step.name}"
            scope = by_id.get(step.scope_id) if step.scope_id else None
            keys[step.id] = f"{key_of(scope)}/{name}" if scope else name
        return keys[step.id]

    for s in steps:
        s.key = key_of(s)
