"""Turn one stored run (raw spans) into a NormalizedRun (steps + transitions).

The normalizer is pure: same spans and same `now` give the same output. It runs
again over the whole run whenever new spans arrive, which is simple and fast
enough for runs of a few hundred spans.

Passes:
1. classify every span with its convention's adapter;
2. infer running steps: a span whose parent hasn't arrived means the parent is
   still running (exporters send a span only when it ends), so we add an
   "inferred" step for it, named from what the child tells us;
3. decide what is hidden (plumbing, duplicate subgraph spans, HTTP spans inside
   model or tool calls);
4. link each step to its nearest visible parent and to its scope (the flow step
   it belongs to), promote nodes that contain other nodes to groups, build keys;
5. give flat agent loops (GenAI: calls directly under the agent) `model` and
   `tools` nodes, as LangGraph records them (loop_nodes.py);
6. derive transitions.
"""

import time
from dataclasses import dataclass

from loopview.cost.pricing import Pricing, default_pricing
from loopview.cost.split import call_cost
from loopview.ingest.raw import RawSpan
from loopview.normalize.adapters import adapter_for
from loopview.normalize.adapters.base import Classification, ParentHint, error_message
from loopview.normalize.loop_nodes import add_loop_nodes
from loopview.normalize.schema import (
    FLOW_KINDS,
    NormalizedRun,
    RunInfo,
    Step,
    StepStatus,
)
from loopview.normalize.transitions import derive_transitions
from loopview.store.memory import Run

# A run that has received nothing for this long is treated as finished even if
# its root span never arrived (for example, the process was killed).
STALE_AFTER_NS = 30 * 1_000_000_000


@dataclass
class _Draft:
    id: str
    raw_parent: str | None
    c: Classification
    span: RawSpan | None  # None for inferred (still running) steps
    convention: str
    start_ns: int
    end_ns: int | None
    hidden: bool = False
    started_only: bool = False  # reported started by loopview-sdk, not ended yet


def normalize_run(
    run: Run, now_ns: int | None = None, pricing: Pricing | None = None
) -> NormalizedRun:
    now_ns = time.time_ns() if now_ns is None else now_ns
    stale = now_ns - run.last_received_ns > STALE_AFTER_NS
    drafts = _classify(run)
    _add_costs(drafts, pricing or default_pricing())
    _add_inferred_parents(run, drafts, stale)
    _place_unclassified_starts(drafts)
    _decide_hidden(drafts)
    steps = add_loop_nodes(_link(run.trace_id, drafts, stale))
    transitions = derive_transitions(steps)
    return NormalizedRun(run=_run_info(run, steps, stale), steps=steps, transitions=transitions)


# --- pass 1 --------------------------------------------------------------------------


def _classify(run: Run) -> dict[str, _Draft]:
    drafts = {}
    for span in run.spans.values():
        adapter = adapter_for(span)
        drafts[span.span_id] = _Draft(
            id=span.span_id,
            raw_parent=span.parent_span_id,
            c=adapter.classify(span),
            span=span,
            convention=adapter.name,
            start_ns=span.start_time_unix_nano,
            end_ns=span.end_time_unix_nano,
        )
    # Start reports (loopview-sdk): real steps, with real names, still running.
    for span in run.started.values():
        adapter = adapter_for(span)
        drafts[span.span_id] = _Draft(
            id=span.span_id,
            raw_parent=span.parent_span_id,
            c=adapter.classify(span),
            span=span,
            convention=adapter.name,
            start_ns=span.start_time_unix_nano,
            end_ns=None,
            started_only=True,
        )
    return drafts


def _add_costs(drafts: dict[str, _Draft], pricing: Pricing) -> None:
    """Each finished model call gets its cost split. A call still running has no
    usage yet, so it gets none."""
    for d in drafts.values():
        if d.c.model is not None and not d.started_only:
            d.c.model.cost = call_cost(d.c.model, pricing)


# --- pass 2 --------------------------------------------------------------------------


def _add_inferred_parents(run: Run, drafts: dict[str, _Draft], stale: bool) -> None:
    known = run.spans.keys() | run.started.keys()
    missing: dict[str, list[RawSpan]] = {}
    for span in [*run.spans.values(), *run.started.values()]:
        if span.parent_span_id and span.parent_span_id not in known:
            missing.setdefault(span.parent_span_id, []).append(span)

    for parent_id, children in missing.items():
        hint: ParentHint | None = None
        convention = "generic"
        for child in children:
            adapter = adapter_for(child)
            hint = adapter.infer_parent(child)
            if hint:
                convention = adapter.name
                break
        if hint:
            c = Classification(hint.kind, hint.name, hint.type_label)
        else:
            # Nothing names it yet: use the service name, which is usually the
            # application the whole run belongs to.
            service = children[0].resource_attributes.get("service.name")
            c = Classification("node", str(service or "running"), "running")
        drafts[parent_id] = _Draft(
            id=parent_id,
            raw_parent=None,  # unknown until its span arrives
            c=c,
            span=None,
            convention=convention,
            start_ns=min(child.start_time_unix_nano for child in children),
            # A stale run won't send this span any more: close it at its last child.
            end_ns=max(c.end_time_unix_nano or c.start_time_unix_nano for c in children)
            if stale
            else None,
        )

    # A trace has exactly one root. Until it arrives, several inferred steps can
    # have no known parent; they all descend from the root, so hang them under
    # the one that started first, which is the closest guess for the root.
    if run.root is None:
        orphans = sorted(
            (d for d in drafts.values() if d.raw_parent is None),
            key=lambda d: (d.start_ns, d.id),
        )
        for orphan in orphans[1:]:
            orphan.raw_parent = orphans[0].id


def _place_unclassified_starts(drafts: dict[str, _Draft]) -> None:
    """Start reports (loopview-sdk) of spans no adapter recognises yet.

    Some instrumentations (OpenInference for LangChain) set every attribute when
    the span ends, so at start a span is just a name. Position is the only clue:
    steps of a flow are direct children of a container (the run's root, or an
    agent), while plumbing (model wrappers, parsers) sits inside a step. So an
    unclassified start is shown as a running node only under a container, and is
    kept hidden otherwise until it ends and its adapter can classify it.
    """
    for d in drafts.values():
        if not d.started_only or d.c.kind != "unknown":
            continue
        parent = drafts.get(d.raw_parent) if d.raw_parent else None
        is_root = d.raw_parent is None
        under_container = parent is not None and (
            parent.raw_parent is None or parent.c.kind == "agent"
        )
        if is_root or under_container:
            d.c.kind = "node"
            d.c.type_label = "running"
            d.c.attributes = {}
        else:
            d.c.hidden = True


# --- pass 3 --------------------------------------------------------------------------


def _decide_hidden(drafts: dict[str, _Draft]) -> None:
    for d in drafts.values():
        parent = drafts.get(d.raw_parent) if d.raw_parent else None
        if d.c.hidden:
            d.hidden = True
        elif d.c.collapse_into_parent and parent is not None and parent.c.name == d.c.name:
            d.hidden = True  # a subgraph span directly inside the node that runs it
        elif d.c.kind == "unknown" and _inside_call(d, drafts):
            d.hidden = True  # e.g. the HTTP request made by a model call


def _inside_call(d: _Draft, drafts: dict[str, _Draft]) -> bool:
    parent_id = d.raw_parent
    while parent_id and parent_id in drafts:
        parent = drafts[parent_id]
        if parent.c.kind in ("model_call", "tool_call"):
            return True
        if parent.c.kind != "unknown":
            return False
        parent_id = parent.raw_parent
    return False


# --- pass 4 --------------------------------------------------------------------------


def _link(run_id: str, drafts: dict[str, _Draft], stale: bool) -> list[Step]:
    def visible_ancestor(d: _Draft, flow_only: bool) -> str | None:
        parent_id = d.raw_parent
        while parent_id and parent_id in drafts:
            parent = drafts[parent_id]
            if not parent.hidden and (not flow_only or parent.c.kind in FLOW_KINDS):
                return parent_id
            parent_id = parent.raw_parent
        return None

    parent_of = {d.id: visible_ancestor(d, flow_only=False) for d in drafts.values()}
    scope_of = {d.id: visible_ancestor(d, flow_only=True) for d in drafts.values()}

    # A node that contains other flow steps is a group: a subgraph or nested agent.
    owners = {
        scope_of[d.id]
        for d in drafts.values()
        if not d.hidden and d.c.kind in FLOW_KINDS and scope_of[d.id]
    }
    for owner_id in owners:
        owner = drafts[owner_id]
        if owner.c.kind == "node":
            owner.c.kind = "agent"
            owner.c.type_label = "agent"

    keys: dict[str, str] = {}

    def key_of(step_id: str) -> str:
        if step_id not in keys:
            d = drafts[step_id]
            name = d.c.name if d.c.kind in FLOW_KINDS else f"{d.c.kind}:{d.c.name}"
            scope = scope_of[step_id]
            keys[step_id] = f"{key_of(scope)}/{name}" if scope else name
        return keys[step_id]

    steps = []
    for d in drafts.values():
        status: StepStatus
        if d.span is None or d.started_only:
            status = "ok" if stale else "running"
        else:
            status = "error" if d.span.status_code == "error" else "ok"
        steps.append(
            Step(
                id=d.id,
                run_id=run_id,
                parent_id=parent_of[d.id],
                scope_id=scope_of[d.id],
                kind=d.c.kind,
                type_label=d.c.type_label,
                name=d.c.name,
                key=key_of(d.id),
                status=status,
                inferred=d.span is None,
                hidden=d.hidden,
                start_ns=d.start_ns,
                end_ns=d.end_ns,
                error=error_message(d.span) if d.span is not None and not d.started_only else None,
                model=d.c.model,
                tool=d.c.tool,
                input=d.c.input,
                output=d.c.output,
                convention=d.convention,
                attributes=d.c.attributes,
            )
        )
    # Deterministic order: by start time, then span id (timestamps can tie).
    steps.sort(key=lambda s: (s.start_ns, s.id))
    return steps


# --- run info ------------------------------------------------------------------------


def _run_info(run: Run, steps: list[Step], stale: bool) -> RunInfo:
    root = run.root
    running = root is None and not stale
    if root is not None and root.status_code == "error":
        status: StepStatus = "error"
    else:
        status = "running" if running else "ok"
    known = [*run.spans.values(), *run.started.values()]
    named_after = root or min(known, key=lambda s: s.start_time_unix_nano)
    # The top step: the real root, or while it's missing the provisional one.
    top_step = next((s for s in steps if s.parent_id is None), None)
    return RunInfo(
        id=run.trace_id,
        name=top_step.name if top_step else named_after.name,
        service_name=named_after.resource_attributes.get("service.name"),
        session_id=run.session_id,
        status=status,
        start_ns=min(s.start_ns for s in steps),
        end_ns=None if running else max(s.end_ns or s.start_ns for s in steps),
        step_count=len(steps),
        last_received_ns=run.last_received_ns,
    )
