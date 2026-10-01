"""Decode OTLP/HTTP trace export requests into RawSpans.

Follows the OTLP specification v1.11.0 (https://opentelemetry.io/docs/specs/otlp/).

Both encodings go through one path: JSON is parsed into the same protobuf message
as the binary encoding, then a single function converts the message to RawSpans.
That works because OTLP/JSON is the standard protobuf JSON mapping with one
exception: trace and span ids are hex strings instead of base64. We rewrite those
ids before parsing and let protobuf handle everything else (camelCase keys, enums
as integers, 64-bit integers as strings, unknown fields ignored).
"""

import base64
import json
import zlib
from typing import Any

from google.protobuf import json_format
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status

from loopview.ingest.raw import RawSpan, SpanEvent, SpanKind, SpanLink, StatusCode

PROTOBUF = "application/x-protobuf"
JSON = "application/json"

# Largest request body we accept, after decompression. Big enough for thousands of
# spans with full prompts; small enough that a bad request can't eat all memory.
MAX_BODY_BYTES = 64 * 1024 * 1024


class OtlpDecodeError(ValueError):
    """The request could not be decoded. Maps to HTTP 400 (not retryable)."""


class UnsupportedContentType(OtlpDecodeError):
    """Neither protobuf nor JSON. Maps to HTTP 415."""


class BodyTooLarge(OtlpDecodeError):
    """Maps to HTTP 413 (not retryable)."""


def decode_request(
    body: bytes, content_type: str | None, content_encoding: str | None = None
) -> list[RawSpan]:
    """Decode one POST /v1/traces body into RawSpans."""
    return decode_body(decompress(body, content_encoding), content_type)


def decode_body(body: bytes, content_type: str | None) -> list[RawSpan]:
    """Decode an already decompressed body into RawSpans."""
    media_type = (content_type or "").split(";")[0].strip().lower()
    if media_type == PROTOBUF:
        request = _parse_protobuf(body)
    elif media_type == JSON:
        request = _parse_json(body)
    else:
        raise UnsupportedContentType(f"unsupported content type: {content_type!r}")
    return request_to_spans(request)


def encode_success_response(content_type: str | None) -> tuple[bytes, str]:
    """An empty ExportTraceServiceResponse in the same encoding as the request."""
    response = ExportTraceServiceResponse()
    if (content_type or "").lower().startswith(JSON):
        return json_format.MessageToJson(response).encode(), JSON
    return response.SerializeToString(), PROTOBUF


def request_to_spans(request: ExportTraceServiceRequest) -> list[RawSpan]:
    spans: list[RawSpan] = []
    for resource_spans in request.resource_spans:
        resource_attributes = _attributes(resource_spans.resource.attributes)
        for scope_spans in resource_spans.scope_spans:
            scope = scope_spans.scope
            for span in scope_spans.spans:
                spans.append(_span(span, resource_attributes, scope.name, scope.version))
    return spans


# --- decoding the body ----------------------------------------------------------


def decompress(body: bytes, content_encoding: str | None) -> bytes:
    """Undo Content-Encoding (identity or gzip), enforcing MAX_BODY_BYTES."""
    encoding = (content_encoding or "identity").strip().lower()
    if encoding == "identity":
        result = body
    elif encoding == "gzip":
        # wbits=16+MAX_WBITS means "expect a gzip header". max_length stops a small
        # compressed body from expanding into gigabytes.
        decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            result = decompressor.decompress(body, MAX_BODY_BYTES + 1)
        except zlib.error as exc:
            raise OtlpDecodeError(f"invalid gzip body: {exc}") from exc
    else:
        raise OtlpDecodeError(f"unsupported content encoding: {content_encoding!r}")
    if len(result) > MAX_BODY_BYTES:
        raise BodyTooLarge(f"request body larger than {MAX_BODY_BYTES} bytes")
    return result


def _parse_protobuf(body: bytes) -> ExportTraceServiceRequest:
    request = ExportTraceServiceRequest()
    try:
        request.ParseFromString(body)
    except Exception as exc:  # protobuf raises DecodeError, but be safe
        raise OtlpDecodeError(f"invalid protobuf body: {exc}") from exc
    return request


def _parse_json(body: bytes) -> ExportTraceServiceRequest:
    try:
        data = json.loads(body)
        _hex_ids_to_base64(data)
        return json_format.ParseDict(data, ExportTraceServiceRequest(), ignore_unknown_fields=True)
    except (ValueError, TypeError, json_format.ParseError) as exc:
        raise OtlpDecodeError(f"invalid JSON body: {exc}") from exc


# OTLP/JSON fields that hold hex ids. Protobuf's JSON parser expects base64 for bytes.
_ID_FIELDS = ("traceId", "spanId", "parentSpanId")


def _hex_ids_to_base64(data: Any) -> None:
    """Rewrite hex trace/span ids in place, on spans and on span links."""
    for resource_spans in data.get("resourceSpans", []):
        for scope_spans in resource_spans.get("scopeSpans", []):
            for span in scope_spans.get("spans", []):
                _convert_ids(span)
                for link in span.get("links", []):
                    _convert_ids(link)


def _convert_ids(obj: dict[str, Any]) -> None:
    for field in _ID_FIELDS:
        value = obj.get(field)
        if value:
            obj[field] = base64.b64encode(bytes.fromhex(value)).decode()


# --- protobuf message to RawSpan ------------------------------------------------

_KINDS: dict[int, SpanKind] = {
    Span.SPAN_KIND_UNSPECIFIED: "unspecified",
    Span.SPAN_KIND_INTERNAL: "internal",
    Span.SPAN_KIND_SERVER: "server",
    Span.SPAN_KIND_CLIENT: "client",
    Span.SPAN_KIND_PRODUCER: "producer",
    Span.SPAN_KIND_CONSUMER: "consumer",
}

_STATUS: dict[int, StatusCode] = {
    Status.STATUS_CODE_UNSET: "unset",
    Status.STATUS_CODE_OK: "ok",
    Status.STATUS_CODE_ERROR: "error",
}


def _span(
    span: Span, resource_attributes: dict[str, Any], scope_name: str, scope_version: str
) -> RawSpan:
    return RawSpan(
        trace_id=span.trace_id.hex(),
        span_id=span.span_id.hex(),
        parent_span_id=span.parent_span_id.hex() or None,
        name=span.name,
        kind=_KINDS.get(span.kind, "unspecified"),
        start_time_unix_nano=span.start_time_unix_nano,
        end_time_unix_nano=span.end_time_unix_nano,
        attributes=_attributes(span.attributes),
        events=[
            SpanEvent(
                name=event.name,
                time_unix_nano=event.time_unix_nano,
                attributes=_attributes(event.attributes),
            )
            for event in span.events
        ],
        links=[
            SpanLink(
                trace_id=link.trace_id.hex(),
                span_id=link.span_id.hex(),
                attributes=_attributes(link.attributes),
            )
            for link in span.links
        ],
        status_code=_STATUS.get(span.status.code, "unset"),
        status_message=span.status.message,
        resource_attributes=resource_attributes,
        scope_name=scope_name,
        scope_version=scope_version,
    )


def _attributes(key_values: "list[KeyValue] | Any") -> dict[str, Any]:
    return {kv.key: _value(kv.value) for kv in key_values}


def _value(value: AnyValue) -> Any:
    """Convert an OTLP AnyValue into a plain Python value."""
    kind = value.WhichOneof("value")
    if kind is None:
        return None
    if kind == "array_value":
        return [_value(v) for v in value.array_value.values]
    if kind == "kvlist_value":
        return _attributes(value.kvlist_value.values)
    if kind == "bytes_value":
        # Keep RawSpans JSON-friendly: bytes become base64 text.
        return base64.b64encode(value.bytes_value).decode()
    return getattr(value, kind)  # string_value, bool_value, int_value, double_value


# --- RawSpan back to OTLP/JSON (for exporting a run) ----------------------------------

_KIND_NUMBERS = {name: number for number, name in _KINDS.items()}
_STATUS_NUMBERS = {name: number for number, name in _STATUS.items()}


def spans_to_otlp_json(spans: list[RawSpan]) -> dict[str, Any]:
    """Encode RawSpans as an OTLP/JSON ExportTraceServiceRequest.

    The inverse of decoding, so an exported run can be imported again through
    the normal receiver path. (Bytes attributes come back as base64 strings.)"""
    groups: dict[tuple[str, str, str], list[RawSpan]] = {}
    for span in spans:
        key = (
            json.dumps(span.resource_attributes, sort_keys=True),
            span.scope_name,
            span.scope_version,
        )
        groups.setdefault(key, []).append(span)
    resource_spans = []
    for (resource_json, scope_name, scope_version), group in groups.items():
        resource_spans.append(
            {
                "resource": {"attributes": _kv_json(json.loads(resource_json))},
                "scopeSpans": [
                    {
                        "scope": {"name": scope_name, "version": scope_version},
                        "spans": [_span_json(s) for s in group],
                    }
                ],
            }
        )
    return {"resourceSpans": resource_spans}


def _span_json(span: RawSpan) -> dict[str, Any]:
    result: dict[str, Any] = {
        "traceId": span.trace_id,
        "spanId": span.span_id,
        "name": span.name,
        "kind": _KIND_NUMBERS[span.kind],
        "startTimeUnixNano": str(span.start_time_unix_nano),
        "endTimeUnixNano": str(span.end_time_unix_nano),
        "attributes": _kv_json(span.attributes),
        "events": [
            {
                "name": e.name,
                "timeUnixNano": str(e.time_unix_nano),
                "attributes": _kv_json(e.attributes),
            }
            for e in span.events
        ],
        "links": [
            {
                "traceId": link.trace_id,
                "spanId": link.span_id,
                "attributes": _kv_json(link.attributes),
            }
            for link in span.links
        ],
        "status": {"code": _STATUS_NUMBERS[span.status_code], "message": span.status_message},
    }
    if span.parent_span_id:
        result["parentSpanId"] = span.parent_span_id
    return result


def _kv_json(attributes: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"key": key, "value": _any_value_json(value)} for key, value in attributes.items()]


def _any_value_json(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, bool):  # before int: bool is a subclass of int
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [_any_value_json(v) for v in value]}}
    if isinstance(value, dict):
        return {"kvlistValue": {"values": _kv_json(value)}}
    return {"stringValue": str(value)}
