"""connect() and agent(): instrumentor choice, and spans reaching loopview."""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from typing import Any

from opentelemetry import trace
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.trace import TracerProvider

import loopview_sdk
from loopview_sdk import choose_instrumentors


def ep(name: str, dist: str) -> Any:
    return SimpleNamespace(name=name, dist=SimpleNamespace(name=dist))


def test_one_instrumentor_per_library_openinference_first() -> None:
    points = [
        ep("openai", "opentelemetry-instrumentation-openai-v2"),
        ep("openai", "openinference-instrumentation-openai"),
        ep("anthropic", "opentelemetry-instrumentation-anthropic"),  # OpenLLMetry
        ep("requests", "opentelemetry-instrumentation-requests"),  # not a GenAI library
        ep("smolagents", "openinference-instrumentation-smolagents"),
    ]
    chosen = {e.name: e.dist.name for e in choose_instrumentors(points)}
    assert chosen == {
        "openai": "openinference-instrumentation-openai",
        "anthropic": "opentelemetry-instrumentation-anthropic",  # the only one there
        "smolagents": "openinference-instrumentation-smolagents",
    }
    only = choose_instrumentors(points, only=["anthropic"])
    assert [e.name for e in only] == ["anthropic"]


def test_connect_and_agent_send_spans_to_loopview() -> None:
    received: dict[str, list[bytes]] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            body = self.rfile.read(int(self.headers["Content-Length"]))
            received.setdefault(self.path, []).append(body)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # As in a script that set up its own provider: connect() adds to the global one.
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    assert loopview_sdk.connect(
        url=f"http://127.0.0.1:{server.server_port}", instrument=False, quiet=True
    ) is provider

    with loopview_sdk.agent("weather"):
        with trace.get_tracer("test").start_as_current_span("chat model"):
            pass
    provider.force_flush()
    server.shutdown()

    spans = []
    for body in received.get("/v1/traces", []):
        request = ExportTraceServiceRequest.FromString(body)
        spans += [s for rs in request.resource_spans for ss in rs.scope_spans for s in ss.spans]
    assert {s.name for s in spans} == {"invoke_agent weather", "chat model"}
    agent_span = next(s for s in spans if s.name == "invoke_agent weather")
    attrs = {a.key: a.value.string_value for a in agent_span.attributes}
    assert attrs["gen_ai.operation.name"] == "invoke_agent"
    assert attrs["gen_ai.agent.name"] == "weather"
    model = next(s for s in spans if s.name == "chat model")
    assert model.parent_span_id == agent_span.span_id  # one run, under the agent
    assert "/v1/loopview/span-starts" in received  # steps light up as they start
