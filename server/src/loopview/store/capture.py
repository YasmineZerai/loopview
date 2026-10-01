"""Capture files: OTLP export requests saved as JSON Lines.

One line per export request, exactly as the receiver got it (after gzip is
undone), plus the time it arrived:

    {"v": 1, "received_at_ns": 17..., "content_type": "application/json", "body_json": {...}}
    {"v": 1, "received_at_ns": 17..., "content_type": "application/x-protobuf", "body_base64": ".."}

JSON bodies are stored as JSON so the file stays readable; protobuf bodies as base64.

The same format is used for three things:
- opt-in persistence (`loopview --persist FILE`): appended to as requests arrive,
  reloaded on the next start;
- test fixtures: real framework output, replayed byte for byte into the receiver;
- the flagship demo recording.

Storing raw requests rather than decoded spans means a capture can be re-decoded
by a newer version of loopview, and the arrival timing is kept for liveness tests.
"""

import base64
import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import IO

from loopview.ingest.otlp import JSON, OtlpDecodeError, decode_body
from loopview.store.memory import TraceStore

FORMAT_VERSION = 1

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CapturedRequest:
    received_at_ns: int
    content_type: str
    body: bytes


def to_line(request: CapturedRequest) -> str:
    record: dict[str, object] = {
        "v": FORMAT_VERSION,
        "received_at_ns": request.received_at_ns,
        "content_type": request.content_type,
    }
    if request.content_type.lower().startswith(JSON):
        record["body_json"] = json.loads(request.body)
    else:
        record["body_base64"] = base64.b64encode(request.body).decode()
    return json.dumps(record, separators=(",", ":"))


def from_line(line: str) -> CapturedRequest:
    record = json.loads(line)
    if record.get("v") != FORMAT_VERSION:
        raise ValueError(f"unsupported capture format version: {record.get('v')!r}")
    if "body_json" in record:
        body = json.dumps(record["body_json"]).encode()
    else:
        body = base64.b64decode(record["body_base64"])
    return CapturedRequest(record["received_at_ns"], record["content_type"], body)


def read_capture(path: Path) -> Iterator[CapturedRequest]:
    """Yield every request in a capture file, skipping lines that don't parse.

    Skipping (with a warning) matters for persistence: if loopview was killed
    mid-write, the last line may be truncated and should not block the next start.
    """
    with path.open(encoding="utf-8") as f:
        for number, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                yield from_line(line)
            except (ValueError, KeyError, TypeError) as exc:
                log.warning("skipping line %d of %s: %s", number, path, exc)


def load_capture(store: TraceStore, path: Path) -> int:
    """Replay a capture file into the store, keeping the recorded arrival times.
    Returns the number of requests loaded."""
    loaded = 0
    for request in read_capture(path):
        try:
            spans = decode_body(request.body, request.content_type)
        except OtlpDecodeError as exc:
            log.warning("skipping undecodable request in %s: %s", path, exc)
            continue
        store.add_spans(spans, received_at_ns=request.received_at_ns)
        loaded += 1
    return loaded


class CaptureWriter:
    """Appends requests to a capture file, flushing after each one."""

    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._file: IO[str] = path.open("a", encoding="utf-8")

    def write(self, request: CapturedRequest) -> None:
        self._file.write(to_line(request) + "\n")
        self._file.flush()

    def close(self) -> None:
        self._file.close()
