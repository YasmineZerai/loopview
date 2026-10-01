import json
from pathlib import Path

from loopview.store.capture import (
    CapturedRequest,
    CaptureWriter,
    from_line,
    load_capture,
    read_capture,
    to_line,
)
from loopview.store.memory import TraceStore
from tests.helpers import official_json_example, record_spans, to_protobuf


def _protobuf_request() -> CapturedRequest:
    def code(tracer):  # type: ignore[no-untyped-def]
        with tracer.start_as_current_span("root"):
            pass

    return CapturedRequest(111, "application/x-protobuf", to_protobuf(record_spans(code)))


def _json_request() -> CapturedRequest:
    return CapturedRequest(222, "application/json", json.dumps(official_json_example()).encode())


def test_protobuf_round_trip() -> None:
    request = _protobuf_request()
    assert from_line(to_line(request)) == request


def test_json_is_stored_readable() -> None:
    line = to_line(_json_request())
    record = json.loads(line)
    assert record["body_json"]["resourceSpans"][0]["resource"]["attributes"][0]["key"] == (
        "service.name"
    )
    restored = from_line(line)
    assert json.loads(restored.body) == official_json_example()


def test_writer_appends_and_load_restores_the_store(tmp_path: Path) -> None:
    path = tmp_path / "sub" / "capture.jsonl"
    writer = CaptureWriter(path)
    writer.write(_protobuf_request())
    writer.write(_json_request())
    writer.close()

    store = TraceStore()
    assert load_capture(store, path) == 2
    runs = store.runs()
    assert len(runs) == 2
    # Arrival times come from the file, not the clock.
    assert sorted(r.first_received_ns for r in runs) == [111, 222]


def test_skips_truncated_and_undecodable_lines(tmp_path: Path) -> None:
    path = tmp_path / "capture.jsonl"
    good = to_line(_json_request())
    undecodable = to_line(CapturedRequest(3, "application/x-protobuf", b"\xff\xff"))
    path.write_text(f"{good}\n\n{undecodable}\n{good[:20]}")

    assert len(list(read_capture(path))) == 2  # truncated last line skipped
    store = TraceStore()
    assert load_capture(store, path) == 1  # undecodable body skipped too
