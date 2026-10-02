"""The normalized schema: the only shape the UI ever sees.

Every span, whatever convention it follows, becomes one Step. Transitions
between steps are derived afterwards (transitions.py). A NormalizedRun is
everything the UI needs to draw one run: its steps and its transitions.

Kinds of steps:
- agent:      a named actor that contains other steps (an agent, a workflow, a
              graph or subgraph). Drawn as a group.
- node:       a named step in a flow (a graph node, a chain step). Drawn as a card.
- model_call: one call to a model. Drawn as a detail of its node, not as a node.
- tool_call:  one tool execution. Drawn as a small satellite of its node.
- unknown:    a span no adapter recognised. Drawn generically, never dropped.
"""

from typing import Any, Literal

from pydantic import BaseModel

StepKind = Literal["agent", "node", "model_call", "tool_call", "unknown"]
StepStatus = Literal["running", "ok", "error"]
TransitionKind = Literal["sequence", "loop", "fan_out", "fan_in", "handoff", "delegate", "return"]

# Steps that take part in control flow (graph nodes). Model and tool calls hang off them.
FLOW_KINDS: frozenset[str] = frozenset({"agent", "node", "unknown"})


class MessagePart(BaseModel):
    type: Literal["text", "reasoning", "tool_call", "tool_result", "other"]
    text: str | None = None  # text and reasoning (thinking) parts, a readable form of "other"
    id: str | None = None  # tool call id, for tool_call and tool_result
    name: str | None = None  # tool name, for tool_call
    arguments: Any = None  # tool_call
    result: Any = None  # tool_result


class Message(BaseModel):
    role: str  # system | user | assistant | tool (kept as given if something else)
    parts: list[MessagePart]


class Usage(BaseModel):
    """Token counts as the provider reported them. None means "not reported",
    which is different from 0. Both specs define the input count as including
    cache reads and writes, and the output count as including thinking."""

    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None  # part of input_tokens
    cache_write_tokens: int | None = None  # part of input_tokens
    reasoning_tokens: int | None = None  # part of output_tokens


CostSegmentName = Literal[
    "tool_prompt",
    "tool_definitions",
    "system",
    "history",
    "tool_results",
    "new_input",
    "cache_read",
    "cache_write",
    "thinking",
    "reply",
    "unattributed",
]


class CostSegment(BaseModel):
    name: CostSegmentName
    side: Literal["input", "output"]
    tokens: int
    dollars: float | None  # None when the model has no price


class CallCost(BaseModel):
    """Where a model call's tokens came from (see loopview/cost/split.py)."""

    # estimated: split from recorded content, scaled to the reported counts
    # content_not_recorded: reported counts, but nothing to split them with
    # no_usage: the instrumentation reported no token counts at all
    status: Literal["estimated", "content_not_recorded", "no_usage"]
    segments: list[CostSegment] = []
    tokens: int | None = None  # reported input + output
    dollars: float | None = None  # None when the model has no price
    price_key: str | None = None  # the pricing entry used
    price_source: str | None = None


class ModelCall(BaseModel):
    provider: str | None = None
    model: str | None = None
    input: list[Message] = []
    output: list[Message] = []
    tool_definitions: list[Any] = []  # the tools the model was given, as recorded
    usage: Usage | None = None  # None when the instrumentation reported no counts
    cost: CallCost | None = None  # set by the normalizer


class ToolCall(BaseModel):
    name: str
    call_id: str | None = None
    arguments: Any = None
    result: Any = None


class Step(BaseModel):
    id: str  # the span id
    run_id: str  # the trace id
    parent_id: str | None  # nearest ancestor step that is not hidden
    scope_id: str | None  # nearest ancestor flow step (agent/node) that is not hidden
    kind: StepKind
    type_label: str  # small label for the UI: "agent", "graph", "node", "llm", "tool"...
    name: str
    key: str  # graph identity: scope path + name. Repeated runs of a node share a key.
    status: StepStatus
    # True when we only know this step exists because its children arrived:
    # exporters send a span when it ends, so a running step has no span yet.
    inferred: bool = False
    hidden: bool = False  # internal plumbing (routing functions, parsers); kept, not drawn
    start_ns: int
    end_ns: int | None  # None while running
    error: str | None = None
    model: ModelCall | None = None
    tool: ToolCall | None = None
    input: Any = None  # generic input/output when the convention provides one
    output: Any = None
    convention: str  # which adapter produced this step: gen_ai | openinference | generic
    attributes: dict[str, Any] = {}  # raw attributes, only for unknown steps


class Transition(BaseModel):
    id: str
    source: str  # step id
    target: str  # step id
    kind: TransitionKind
    inferred: bool = True  # derived from timing and nesting, not stated by the framework


class RunInfo(BaseModel):
    id: str
    name: str
    service_name: str | None
    session_id: str | None
    status: StepStatus
    start_ns: int
    end_ns: int | None
    step_count: int
    last_received_ns: int


class NormalizedRun(BaseModel):
    run: RunInfo
    steps: list[Step]
    transitions: list[Transition]
