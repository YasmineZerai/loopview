"""Which tools an agent struggles with, across many runs.

Pure functions over normalized runs: no I/O, no store. The API picks the runs.

Definitions (also in DECISIONS.md D44):

- Tool call: a finished `tool_call` step. Running calls are left out.
- Error: the call is marked failed by the trace: span status ERROR (with or
  without an exception event), or an MCP result with `isError: true`. Errors are
  never guessed from the result text.
- Canonical arguments: the arguments as JSON with sorted keys, so identical calls
  compare equal.
- Agent: the nearest agent above the call, by name, within its run.
- Next move after an error: what the agent does once the error is back in front
  of the model. Models often request several tools in one turn, so the call that
  happens to start next was usually requested before the model saw the error.
  So each tool call is assigned to the model call that requested it (the
  agent's latest model call that had ended when the tool started), and we look
  at the turns whose model call started after the failed call ended:
    blind_retry  the same tool with identical canonical arguments
    fixed        the same tool with different arguments (and whether that worked)
    switched     a different tool, recorded as the pair (failed -> next)
    gave_up      no further tool call by that agent in that run
  Calls to tools that also failed in the failed call's own turn are skipped:
  they are those tools' own retries. When an agent has no recorded model calls,
  the next move is simply its next tool call started after the error ended.
- Error group: the error message with UUIDs, hex ids, long quoted values and
  numbers replaced by placeholders, trimmed to 200 characters.
- Confused pair: (A -> B) from `switched`, counted across runs; reported from two
  occurrences.
- Offered tools: the tool definitions recorded on model calls. If no model call
  in the input records any, the tool list is "not recorded" and nothing is
  inferred about unused tools.
- Never called: offered at least once, called zero times in the input runs.
- Definition cost (estimate): a definition's JSON length / 4, times the number of
  model calls that carried it.
- Result size (estimate): the average result length / 4 over successful calls
  (Pydantic AI records its retry prompt as the result of a failed call).
"""

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Literal

from loopview.normalize.schema import NormalizedRun, Step

CHARS_PER_TOKEN = 4
ERROR_GROUP_MAX = 200
TOP_ERRORS = 3
MIN_CONFUSED = 2

Move = Literal["blind_retry", "fixed", "switched", "gave_up"]


# --- small helpers -------------------------------------------------------------------


def canonical_args(arguments: Any) -> str:
    return json.dumps(arguments, sort_keys=True, default=str, ensure_ascii=False)


def estimate_tokens(value: Any) -> int:
    text = value if isinstance(value, str) else canonical_args(value)
    return math.ceil(len(text) / CHARS_PER_TOKEN)  # anything non-empty is a token


_UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
# 0x-prefixed, or a run of 8+ hex characters that contains a digit (ids, hashes)
_HEX = re.compile(r"\b0x[0-9a-fA-F]+\b|\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{8,}\b")
_LONG_QUOTED = re.compile(r"'[^']{13,}'|\"[^\"]{13,}\"")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def error_group(message: str) -> str:
    text = _UUID.sub("<uuid>", message)
    text = _HEX.sub("<id>", text)
    text = _LONG_QUOTED.sub("<value>", text)
    text = _NUMBER.sub("<n>", text)
    return " ".join(text.split())[:ERROR_GROUP_MAX]


def _mcp_is_error(result: Any) -> bool:
    return isinstance(result, dict) and result.get("isError") is True


def _mcp_error_text(result: dict[str, Any]) -> str:
    texts = [
        str(c.get("text"))
        for c in result.get("content") or []
        if isinstance(c, dict) and c.get("text")
    ]
    return "\n".join(texts) or "isError"


def definition_name(definition: Any) -> str | None:
    """Tool definitions come as {"name": ...} (GenAI, Anthropic, OpenInference) or
    OpenAI's {"type": "function", "function": {"name": ...}}."""
    if not isinstance(definition, dict):
        return None
    name = definition.get("name")
    if name is None and isinstance(definition.get("function"), dict):
        name = definition["function"].get("name")
    return str(name) if name else None


# --- calls -----------------------------------------------------------------------------


@dataclass
class Call:
    run_id: str
    step_id: str
    agent: str
    name: str
    start: int
    end: int
    args: Any
    canonical: str
    result: Any
    error: str | None  # None when the call succeeded

    @property
    def failed(self) -> bool:
        return self.error is not None

    def ref(self) -> dict[str, str]:
        return {"run_id": self.run_id, "step_id": self.step_id}


def _agent_of(step: Step, by_id: dict[str, Step]) -> str:
    parent = by_id.get(step.parent_id) if step.parent_id else None
    while parent is not None:
        if parent.kind == "agent":
            return parent.name
        parent = by_id.get(parent.parent_id) if parent.parent_id else None
    return ""  # a call outside any agent: the run itself is its agent


def _calls(run: NormalizedRun, by_id: dict[str, Step]) -> list[Call]:
    calls = []
    for s in run.steps:
        if s.kind != "tool_call" or s.tool is None or s.end_ns is None or s.status == "running":
            continue
        error = None
        if s.status == "error":
            error = s.error or "error"
        elif _mcp_is_error(s.tool.result):
            error = _mcp_error_text(s.tool.result)
        calls.append(
            Call(
                run_id=s.run_id,
                step_id=s.id,
                agent=_agent_of(s, by_id),
                name=s.tool.name or s.name,
                start=s.start_ns,
                end=s.end_ns,
                args=s.tool.arguments,
                canonical=canonical_args(s.tool.arguments),
                result=s.tool.result,
                error=error,
            )
        )
    return sorted(calls, key=lambda c: (c.start, c.step_id))


# --- next move after an error -----------------------------------------------------------


@dataclass
class NextMove:
    move: Move
    next_tool: str | None = None  # for switched
    succeeded: bool | None = None  # for fixed


def _turn_of(call: Call, model_calls: list[tuple[int, int]]) -> int:
    """Index of the model call that requested `call`: the latest one that had
    ended when the call started. Comparing with the end, not the start, keeps
    this right when timestamps tie (a coarse clock, DECISIONS D17). -1: none."""
    turn = -1
    for i, (_, end) in enumerate(model_calls):
        if end <= call.start:
            turn = i
    return turn


def next_move(
    failed: Call, agent_calls: list[Call], model_calls: list[tuple[int, int]]
) -> NextMove:
    """What the agent did after `failed` (see the module docstring).
    `model_calls` are the agent's model calls as (start, end), sorted by start."""
    others = [c for c in agent_calls if c is not failed]
    if not model_calls:
        later = [c for c in others if c.start >= failed.end]
        turns = [later[:1]] if later else []
        skip: set[str] = set()
    else:
        own = _turn_of(failed, model_calls)
        by_turn: dict[int, list[Call]] = {}
        for c in others:
            by_turn.setdefault(_turn_of(c, model_calls), []).append(c)
        # Turns whose model call started once the error was back: it saw the error.
        turns = [by_turn[i] for i in sorted(by_turn) if i > own and model_calls[i][0] >= failed.end]
        skip = {c.name for c in by_turn.get(own, []) if c.failed and c.name != failed.name}
    for turn in turns:
        same = [c for c in turn if c.name == failed.name]
        if any(c.canonical == failed.canonical for c in same):
            return NextMove("blind_retry")
        if same:
            return NextMove("fixed", succeeded=not same[0].failed)
        switched = [c for c in turn if c.name not in skip]
        if switched:
            return NextMove("switched", next_tool=switched[0].name)
    return NextMove("gave_up")


# --- the report ----------------------------------------------------------------------------


@dataclass
class _ToolStats:
    calls: list[Call] = field(default_factory=list)
    moves: Counter[str] = field(default_factory=Counter)
    switched_to: Counter[str] = field(default_factory=Counter)


def tools_report(runs: list[NormalizedRun]) -> dict[str, Any]:
    stats: dict[str, _ToolStats] = {}
    pairs: Counter[tuple[str, str]] = Counter()
    offered_size: dict[str, int] = {}  # tool -> definition size in tokens (largest seen)
    carried: Counter[str] = Counter()  # tool -> model calls that carried its definition
    tool_list_recorded = False
    all_calls: list[Call] = []

    for run in runs:
        by_id = {s.id: s for s in run.steps}
        calls = _calls(run, by_id)
        all_calls += calls
        model_calls: dict[str, list[tuple[int, int]]] = {}
        for s in run.steps:
            if s.kind != "model_call":
                continue
            # A running model call hasn't requested anything yet.
            end = s.end_ns if s.end_ns is not None else 2**63
            model_calls.setdefault(_agent_of(s, by_id), []).append((s.start_ns, end))
            definitions = s.model.tool_definitions if s.model else []
            if definitions:
                tool_list_recorded = True
            for d in definitions:
                name = definition_name(d)
                if name:
                    carried[name] += 1
                    offered_size[name] = max(offered_size.get(name, 0), estimate_tokens(d))
        for spans in model_calls.values():
            spans.sort()

        by_agent: dict[str, list[Call]] = {}
        for c in calls:
            by_agent.setdefault(c.agent, []).append(c)
            stats.setdefault(c.name, _ToolStats()).calls.append(c)
        for c in calls:
            if not c.failed:
                continue
            move = next_move(c, by_agent[c.agent], model_calls.get(c.agent, []))
            tool = stats[c.name]
            tool.moves[move.move] += 1
            if move.move == "fixed" and move.succeeded:
                tool.moves["fixed_succeeded"] += 1
            if move.move == "switched" and move.next_tool:
                tool.switched_to[move.next_tool] += 1
                pairs[(c.name, move.next_tool)] += 1

    tools = [_tool_entry(name, s, pairs) for name, s in stats.items()]
    tools.sort(key=lambda t: (-t["errors"], -t["calls"], t["name"]))

    called = set(stats)
    never_called = []
    if tool_list_recorded:
        never_called = [
            {
                "name": name,
                "definition_tokens_estimate": offered_size[name] * carried[name],
                "carried_by_model_calls": carried[name],
            }
            for name in sorted(set(carried) - called)
        ]
        never_called.sort(key=lambda t: (-t["definition_tokens_estimate"], t["name"]))

    errors = sum(t["errors"] for t in tools)
    top_two = sum(sorted((t["errors"] for t in tools), reverse=True)[:2])
    never_tokens = sum(t["definition_tokens_estimate"] for t in never_called)
    return {
        "summary": {
            "runs": len(runs),
            "tool_calls": len(all_calls),
            "errors": errors,
            "share_of_errors_from_top_2_tools": round(top_two / errors, 3) if errors else None,
            "never_called_count": len(never_called),
            "never_called_tokens_estimate": never_tokens,
            "never_called_tokens_per_run_estimate": round(never_tokens / len(runs)) if runs else 0,
        },
        "tools": tools,
        "never_called": never_called,
        "tool_list_recorded": tool_list_recorded,
    }


def _tool_entry(name: str, s: _ToolStats, pairs: Counter[tuple[str, str]]) -> dict[str, Any]:
    failures = [c for c in s.calls if c.failed]
    groups: dict[str, list[Call]] = {}
    for c in failures:
        groups.setdefault(error_group(c.error or ""), []).append(c)
    top = sorted(groups.items(), key=lambda g: (-len(g[1]), g[0]))[:TOP_ERRORS]
    results = [estimate_tokens(c.result) for c in s.calls if not c.failed and c.result is not None]
    return {
        "name": name,
        "calls": len(s.calls),
        "errors": len(failures),
        "error_rate": round(len(failures) / len(s.calls), 3),
        "after_error": {
            k: s.moves[k]
            for k in ("blind_retry", "fixed", "fixed_succeeded", "switched", "gave_up")
        },
        "top_errors": [
            {
                "message_group": group,
                "count": len(examples),
                "example_args": examples[0].args,
                "example_message": examples[0].error,
                "step_ref": examples[0].ref(),
            }
            for group, examples in top
        ],
        "confused_with": [
            {"tool": other, "count": n}
            for (a, other), n in pairs.most_common()
            if a == name and n >= MIN_CONFUSED
        ],
        "avg_result_tokens_estimate": round(sum(results) / len(results)) if results else None,
        "step_refs": [c.ref() for c in s.calls],
    }
