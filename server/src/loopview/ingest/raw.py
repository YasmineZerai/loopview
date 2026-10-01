"""RawSpan: an OpenTelemetry span decoded from OTLP, with no interpretation.

This is the boundary between "wire format" and "meaning". The ingest layer turns
OTLP bytes into RawSpans; the normalize layer (M3) turns RawSpans into the
internal schema. Nothing here knows about gen_ai, OpenInference or any framework.

Attribute values are plain Python values (str, bool, int, float, list, dict), so
RawSpans are easy to test, print and write to JSON.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

SpanKind = Literal["unspecified", "internal", "server", "client", "producer", "consumer"]
StatusCode = Literal["unset", "ok", "error"]


class SpanEvent(BaseModel):
    name: str
    time_unix_nano: int
    attributes: dict[str, Any] = Field(default_factory=dict)


class SpanLink(BaseModel):
    trace_id: str
    span_id: str
    attributes: dict[str, Any] = Field(default_factory=dict)


class RawSpan(BaseModel):
    trace_id: str  # 32 lowercase hex chars
    span_id: str  # 16 lowercase hex chars
    parent_span_id: str | None = None  # None for a root span
    name: str
    kind: SpanKind = "unspecified"
    start_time_unix_nano: int
    end_time_unix_nano: int
    attributes: dict[str, Any] = Field(default_factory=dict)
    events: list[SpanEvent] = Field(default_factory=list)
    links: list[SpanLink] = Field(default_factory=list)
    status_code: StatusCode = "unset"
    status_message: str = ""
    # Where the span came from: the process (resource) and the library (scope).
    resource_attributes: dict[str, Any] = Field(default_factory=dict)
    scope_name: str = ""
    scope_version: str = ""
