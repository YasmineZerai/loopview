"""Copy one run (trace) out of a capture file into a capture of its own.

A capture holds raw export requests, and one request can carry spans of several
traces. Each request is filtered down to the spans of the chosen trace and written
back with its arrival time, so the new capture replays exactly like the original
did for that run. Requests are written as protobuf (a JSON body is converted).

Used to turn one run of a long recording (a pilot of a real app) into a fixture.
`--redact OLD=NEW` replaces a string in every attribute, event and status message
first, so a fixture headed for a public demo doesn't carry a local path (stack
traces name the user's home folder). It may be given more than once.

Usage (from server/):
    uv run python -m loopview.devtools.extract_run CAPTURE TRACE_ID OUT [--redact OLD=NEW]...
"""

import sys
from pathlib import Path

from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span

from loopview.ingest.otlp import PROTOBUF, parse_request
from loopview.store.capture import CapturedRequest, read_capture, to_line


def _redact_value(value: AnyValue, replace: dict[str, str]) -> None:
    if value.HasField("string_value"):
        text = value.string_value
        for old, new in replace.items():
            text = text.replace(old, new)
        value.string_value = text
    elif value.HasField("array_value"):
        for item in value.array_value.values:
            _redact_value(item, replace)
    elif value.HasField("kvlist_value"):
        _redact_attributes(value.kvlist_value.values, replace)


def _redact_attributes(attributes: "list[KeyValue]", replace: dict[str, str]) -> None:
    for attribute in attributes:
        _redact_value(attribute.value, replace)


def redact(span: Span, replace: dict[str, str]) -> None:
    _redact_attributes(span.attributes, replace)
    for event in span.events:
        _redact_attributes(event.attributes, replace)
    for old, new in replace.items():
        span.status.message = span.status.message.replace(old, new)


def extract(capture: Path, trace_id: str, out: Path, replace: dict[str, str] | None = None) -> int:
    """Write the requests of `trace_id` to `out`; returns how many spans were kept."""
    wanted = bytes.fromhex(trace_id)
    kept = 0
    lines = []
    for request in read_capture(capture):
        message = parse_request(request.body, request.content_type)
        for resource_spans in message.resource_spans:
            for scope_spans in resource_spans.scope_spans:
                spans = [s for s in scope_spans.spans if s.trace_id == wanted]
                for span in spans:
                    redact(span, replace or {})
                del scope_spans.spans[:]
                scope_spans.spans.extend(spans)
                kept += len(spans)
            scopes = [s for s in resource_spans.scope_spans if s.spans]
            del resource_spans.scope_spans[:]
            resource_spans.scope_spans.extend(scopes)
        resources = [r for r in message.resource_spans if r.scope_spans]
        if not resources:
            continue
        del message.resource_spans[:]
        message.resource_spans.extend(resources)
        body = message.SerializeToString()
        lines.append(to_line(CapturedRequest(request.received_at_ns, PROTOBUF, body)))
    out.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")
    return kept


def main() -> None:
    args = sys.argv[1:]
    replace: dict[str, str] = {}
    while "--redact" in args:
        at = args.index("--redact")
        old, _, new = args[at + 1].partition("=")
        replace[old] = new
        del args[at : at + 2]
    if len(args) != 3:
        sys.exit(__doc__)
    capture, trace_id, out = Path(args[0]), args[1], Path(args[2])
    kept = extract(capture, trace_id, out, replace)
    if not kept:
        sys.exit(f"no span of trace {trace_id} in {capture}")
    print(f"wrote {out} ({kept} spans)")


if __name__ == "__main__":
    main()
