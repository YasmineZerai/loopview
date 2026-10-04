"""loopview-sdk: tell loopview when spans *start*, for true real-time views.

Standard OpenTelemetry exporters send a span only when it ends, so on its own
loopview sees a step only after it finished (it infers running parents from
their finished children). Add this processor next to your normal exporter and
loopview also hears about every span the moment it starts:

    from loopview_sdk import LiveStartProcessor
    provider.add_span_processor(LiveStartProcessor())

It only reports starts; your normal exporter still sends the finished spans.
Reports are batched every 50 ms and sent from a background thread, so the
agent never waits on loopview. If loopview isn't running, reports are dropped.

Dependencies: opentelemetry-sdk only (HTTP is done with the standard library).
"""

import json
import os
import queue
import threading
import urllib.request
from typing import Any

from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor

DEFAULT_ENDPOINT = "http://127.0.0.1:4318/v1/loopview/span-starts"
_KIND = {"INTERNAL": 1, "SERVER": 2, "CLIENT": 3, "PRODUCER": 4, "CONSUMER": 5}


class LiveStartProcessor(SpanProcessor):
    def __init__(self, endpoint: str | None = None, interval_s: float = 0.05) -> None:
        self.endpoint = endpoint or os.environ.get("LOOPVIEW_STARTS_ENDPOINT", DEFAULT_ENDPOINT)
        self.interval_s = interval_s
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=10_000)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="loopview-starts", daemon=True)
        self._thread.start()

    # --- SpanProcessor -----------------------------------------------------------------

    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        try:
            self._queue.put_nowait(_encode(span))
        except queue.Full:
            pass  # never slow the agent down

    def on_end(self, span: ReadableSpan) -> None:
        pass  # finished spans go through the user's normal exporter

    def shutdown(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)
        self._flush()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        self._flush()
        return True

    # --- background sending --------------------------------------------------------------

    def _run(self) -> None:
        while not self._stop.wait(self.interval_s):
            self._flush()

    def _flush(self) -> None:
        batch: list[dict[str, Any]] = []
        while True:
            try:
                batch.append(self._queue.get_nowait())
            except queue.Empty:
                break
        if not batch:
            return
        body = json.dumps(_request(batch)).encode()
        request = urllib.request.Request(
            self.endpoint, data=body, headers={"Content-Type": "application/json"}
        )
        try:
            urllib.request.urlopen(request, timeout=2).close()
        except OSError:
            pass  # loopview not running: drop, like a best-effort exporter


# --- OTLP/JSON encoding of a just-started span ---------------------------------------------


def _encode(span: Span) -> dict[str, Any]:
    ctx = span.get_span_context()
    encoded: dict[str, Any] = {
        "traceId": format(ctx.trace_id, "032x"),
        "spanId": format(ctx.span_id, "016x"),
        "name": span.name,
        "kind": _KIND.get(span.kind.name, 0),
        "startTimeUnixNano": str(span.start_time or 0),
        "attributes": _kv(dict(span.attributes or {})),
    }
    if span.parent is not None:
        encoded["parentSpanId"] = format(span.parent.span_id, "016x")
    scope = span.instrumentation_scope
    return {
        "span": encoded,
        "resource": dict(span.resource.attributes) if span.resource else {},
        "scope": (scope.name, scope.version or "") if scope else ("", ""),
    }


def _request(batch: list[dict[str, Any]]) -> dict[str, Any]:
    """Group encoded spans by resource and scope into one ExportTraceServiceRequest."""
    groups: dict[str, dict[str, Any]] = {}
    for item in batch:
        key = json.dumps([item["resource"], item["scope"]], sort_keys=True, default=str)
        group = groups.setdefault(key, {
            "resource": {"attributes": _kv(item["resource"])},
            "scopeSpans": [{"scope": {"name": item["scope"][0], "version": item["scope"][1]},
                            "spans": []}],
        })
        group["scopeSpans"][0]["spans"].append(item["span"])
    return {"resourceSpans": list(groups.values())}


def _kv(attributes: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"key": k, "value": _value(v)} for k, v in attributes.items()]


def _value(v: Any) -> dict[str, Any]:
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [_value(x) for x in v]}}
    return {"stringValue": str(v)}
