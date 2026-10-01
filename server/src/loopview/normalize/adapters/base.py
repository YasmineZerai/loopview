"""The adapter contract.

An adapter knows one span convention. For one span, it answers:
- does this span follow my convention? (`matches`)
- what is it? (`classify`, returning a Classification)
- if this span arrived but its parent hasn't yet, what can I tell about the
  parent? (`infer_parent`, used to show still-running steps with a real name)

Adding a convention means writing one adapter and adding it to ADAPTERS in
normalize/adapters/__init__.py. Nothing else changes.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from loopview.ingest.raw import RawSpan
from loopview.normalize.schema import ModelCall, StepKind, ToolCall


@dataclass
class Classification:
    kind: StepKind
    name: str
    type_label: str
    hidden: bool = False
    model: ModelCall | None = None
    tool: ToolCall | None = None
    input: Any = None
    output: Any = None
    # When True, a later pass hides this step if its parent has the same name
    # (a subgraph span nested directly in the node that runs it).
    collapse_into_parent: bool = False
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class ParentHint:
    name: str
    kind: StepKind
    type_label: str


class Adapter(Protocol):
    name: str

    def matches(self, span: RawSpan) -> bool: ...

    def classify(self, span: RawSpan) -> Classification: ...

    def infer_parent(self, span: RawSpan) -> ParentHint | None: ...


# --- helpers shared by adapters ---------------------------------------------------


def maybe_json(value: Any) -> Any:
    """Parse a JSON string; return anything else (or unparseable text) unchanged.

    Conventions allow structured values to be recorded as JSON strings when the
    exporter can't carry structure, so the same attribute can arrive either way."""
    if isinstance(value, str) and value[:1] in ("{", "[", '"'):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def error_message(span: RawSpan) -> str | None:
    """The error of a failed span: the status message, or the recorded exception."""
    if span.status_code != "error":
        return None
    for event in span.events:
        if event.name == "exception":
            message = event.attributes.get("exception.message")
            kind = event.attributes.get("exception.type")
            if message or kind:
                return ": ".join(str(x) for x in (kind, message) if x)
    return span.status_message or span.attributes.get("error.type") or "error"
