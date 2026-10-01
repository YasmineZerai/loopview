"""Test helpers.

`record_spans` runs code against the real OpenTelemetry SDK and returns what it
recorded, so protobuf payloads in tests are real SDK output, not hand-built bytes.
"""

import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Tracer

from loopview.ingest.raw import RawSpan

DATA_DIR = Path(__file__).parent / "data"


def record_spans(
    code: Callable[[Tracer], None], service_name: str = "test-service"
) -> Sequence[ReadableSpan]:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    code(provider.get_tracer("loopview.tests", "1.0"))
    provider.shutdown()
    return exporter.get_finished_spans()


def to_protobuf(spans: Sequence[ReadableSpan]) -> bytes:
    """Encode spans exactly as the OTLP/HTTP protobuf exporter does."""
    return encode_spans(spans).SerializeToString()


def official_json_example() -> dict[str, Any]:
    """opentelemetry-proto/examples/trace.json, copied unchanged from the official repo."""
    return json.loads((DATA_DIR / "otlp_example_trace.json").read_text())


def make_span(
    trace_id: str,
    span_id: str,
    parent_span_id: str | None = None,
    name: str = "span",
    start: int = 0,
    end: int = 1,
    **attributes: Any,
) -> RawSpan:
    """A RawSpan for store tests, which don't care about the wire format.
    Attribute keys use `__` for dots: session__id="s" becomes "session.id"."""
    return RawSpan(
        trace_id=trace_id,
        span_id=span_id,
        parent_span_id=parent_span_id,
        name=name,
        start_time_unix_nano=start,
        end_time_unix_nano=end,
        attributes={k.replace("__", "."): v for k, v in attributes.items()},
    )
