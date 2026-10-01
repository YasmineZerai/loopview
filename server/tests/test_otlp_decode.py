import gzip
import json

import pytest
from opentelemetry.trace import SpanKind, Status, StatusCode, Tracer

from loopview.ingest import otlp
from loopview.ingest.otlp import (
    BodyTooLarge,
    OtlpDecodeError,
    UnsupportedContentType,
    decode_request,
)
from tests.helpers import official_json_example, record_spans, to_protobuf


def _agent_with_failing_tool(tracer: Tracer) -> None:
    with tracer.start_as_current_span("agent", kind=SpanKind.INTERNAL) as agent:
        agent.set_attribute("text", "hello")
        agent.set_attribute("count", 3)
        agent.set_attribute("ratio", 0.5)
        agent.set_attribute("flag", True)
        agent.set_attribute("tags", ["a", "b"])
        with tracer.start_as_current_span("tool", kind=SpanKind.CLIENT) as tool:
            tool.add_event("retry", {"attempt": 2})
            tool.set_status(Status(StatusCode.ERROR, "timed out"))


def test_decodes_real_sdk_protobuf() -> None:
    sdk_spans = record_spans(_agent_with_failing_tool)
    spans = decode_request(to_protobuf(sdk_spans), "application/x-protobuf")

    by_name = {s.name: s for s in spans}
    agent, tool = by_name["agent"], by_name["tool"]

    assert agent.trace_id == tool.trace_id
    assert len(agent.trace_id) == 32 and agent.trace_id == agent.trace_id.lower()
    assert agent.parent_span_id is None
    assert tool.parent_span_id == agent.span_id
    assert agent.kind == "internal" and tool.kind == "client"
    assert agent.attributes == {
        "text": "hello",
        "count": 3,
        "ratio": 0.5,
        "flag": True,
        "tags": ["a", "b"],
    }
    assert tool.events[0].name == "retry"
    assert tool.events[0].attributes == {"attempt": 2}
    assert (tool.status_code, tool.status_message) == ("error", "timed out")
    assert agent.resource_attributes["service.name"] == "test-service"
    assert (agent.scope_name, agent.scope_version) == ("loopview.tests", "1.0")
    assert agent.start_time_unix_nano <= tool.start_time_unix_nano
    assert tool.end_time_unix_nano <= agent.end_time_unix_nano


def test_decodes_official_json_example() -> None:
    body = json.dumps(official_json_example()).encode()
    [span] = decode_request(body, "application/json")

    # Hex ids come out lowercase, whatever case the JSON used.
    assert span.trace_id == "5b8efff798038103d269b633813fc60c"
    assert span.span_id == "eee19b7ec3c1b174"
    assert span.parent_span_id == "eee19b7ec3c1b173"
    assert span.name == "I'm a server span"
    assert span.kind == "server"  # encoded as the integer 2
    assert span.start_time_unix_nano == 1544712660000000000  # encoded as a string
    assert span.attributes == {"my.span.attr": "some value"}
    assert span.resource_attributes == {"service.name": "my.service"}
    assert (span.scope_name, span.scope_version) == ("my.library", "1.0.0")


def test_json_accepts_numbers_for_int64_and_ignores_unknown_fields() -> None:
    data = official_json_example()
    span = data["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
    span["startTimeUnixNano"] = 1544712660000000000
    span["someFutureField"] = {"x": 1}
    [decoded] = decode_request(json.dumps(data).encode(), "application/json; charset=utf-8")
    assert decoded.start_time_unix_nano == 1544712660000000000


def test_gzip_body() -> None:
    body = gzip.compress(to_protobuf(record_spans(_agent_with_failing_tool)))
    spans = decode_request(body, "application/x-protobuf", content_encoding="gzip")
    assert {s.name for s in spans} == {"agent", "tool"}


def test_empty_request_has_no_spans() -> None:
    assert decode_request(b"", "application/x-protobuf") == []


def test_rejects_unknown_content_type() -> None:
    with pytest.raises(UnsupportedContentType):
        decode_request(b"hello", "text/plain")


@pytest.mark.parametrize(
    ("body", "content_type"),
    [(b"\xff\xff\xff", "application/x-protobuf"), (b"{not json", "application/json")],
)
def test_rejects_garbage(body: bytes, content_type: str) -> None:
    with pytest.raises(OtlpDecodeError):
        decode_request(body, content_type)


def test_rejects_oversized_gzip_body(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(otlp, "MAX_BODY_BYTES", 100)
    with pytest.raises(BodyTooLarge):
        decode_request(gzip.compress(b"\0" * 1000), "application/x-protobuf", "gzip")
