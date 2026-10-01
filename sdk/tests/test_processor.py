import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider

from loopview_sdk import LiveStartProcessor


def test_reports_span_starts_as_otlp_json() -> None:
    received: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers["Content-Length"])
            received.append(json.loads(self.rfile.read(length)))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    endpoint = f"http://127.0.0.1:{server.server_port}/v1/loopview/span-starts"

    provider = TracerProvider(resource=Resource.create({"service.name": "sdk-test"}))
    processor = LiveStartProcessor(endpoint=endpoint)
    provider.add_span_processor(processor)
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("agent", attributes={"gen_ai.operation.name": "invoke_agent"}):
        with tracer.start_as_current_span("tool"):
            pass
    provider.shutdown()
    server.shutdown()

    spans = [
        span
        for request in received
        for rs in request["resourceSpans"]
        for ss in rs["scopeSpans"]
        for span in ss["spans"]
    ]
    by_name = {s["name"]: s for s in spans}
    assert set(by_name) == {"agent", "tool"}
    assert by_name["tool"]["parentSpanId"] == by_name["agent"]["spanId"]
    assert "endTimeUnixNano" not in by_name["agent"]
    assert by_name["agent"]["attributes"][0] == {
        "key": "gen_ai.operation.name",
        "value": {"stringValue": "invoke_agent"},
    }


def test_never_raises_when_loopview_is_down() -> None:
    provider = TracerProvider()
    provider.add_span_processor(LiveStartProcessor(endpoint="http://127.0.0.1:9/nope"))
    with provider.get_tracer("t").start_as_current_span("x"):
        pass
    provider.shutdown()  # flushes; the failed send is swallowed
