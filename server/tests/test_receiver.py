"""The OTLP receiver, through HTTP.

The last test is end to end: the real OpenTelemetry SDK and its real OTLP/HTTP
exporter send spans to a real loopview server over a socket.
"""

import json
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceResponse
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from loopview.app import create_app
from loopview.store.capture import CaptureWriter, read_capture
from loopview.store.memory import TraceStore
from tests.helpers import official_json_example, record_spans, to_protobuf


def _nested(tracer):  # type: ignore[no-untyped-def]
    with tracer.start_as_current_span("agent"):
        with tracer.start_as_current_span("tool"):
            pass


def test_protobuf_request() -> None:
    client = TestClient(create_app(store=TraceStore()))
    response = client.post(
        "/v1/traces",
        content=to_protobuf(record_spans(_nested)),
        headers={"content-type": "application/x-protobuf"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-protobuf"
    ExportTraceServiceResponse().ParseFromString(response.content)  # valid response

    [run] = client.get("/api/runs").json()
    assert run["name"] == "agent" and run["step_count"] == 2
    spans = client.get(f"/api/runs/{run['id']}/spans").json()
    # Compare as a set: on Windows the SDK clock is coarse, so parent and child can
    # share a start timestamp and their order is not defined.
    assert {s["name"] for s in spans} == {"agent", "tool"}


def test_json_request() -> None:
    client = TestClient(create_app(store=TraceStore()))
    response = client.post("/v1/traces", json=official_json_example())
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    # The example span's parent was never sent (it lives in another service), so
    # the run's top step is that inferred parent, named after the service.
    [run] = client.get("/api/runs").json()
    assert run["name"] == "my.service"
    steps = client.get(f"/api/runs/{run['id']}").json()["steps"]
    assert "I'm a server span" in {s["name"] for s in steps}


@pytest.mark.parametrize(
    ("body", "content_type", "status"),
    [
        (b"hello", "text/plain", 415),
        (b"\xff\xff\xff", "application/x-protobuf", 400),
        (b"{broken", "application/json", 400),
    ],
)
def test_bad_requests(body: bytes, content_type: str, status: int) -> None:
    client = TestClient(create_app(store=TraceStore()))
    response = client.post("/v1/traces", content=body, headers={"content-type": content_type})
    assert response.status_code == status


def test_unknown_run_is_404() -> None:
    client = TestClient(create_app(store=TraceStore()))
    assert client.get("/api/runs/" + "0" * 32 + "/spans").status_code == 404


def test_sessions_endpoint() -> None:
    data = official_json_example()
    span = data["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
    span["attributes"].append({"key": "session.id", "value": {"stringValue": "s1"}})
    client = TestClient(create_app(store=TraceStore()))
    client.post("/v1/traces", json=data)
    assert client.get("/api/sessions").json() == [
        {"session_id": "s1", "trace_ids": ["5b8efff798038103d269b633813fc60c"]}
    ]


def test_persists_received_requests(tmp_path: Path) -> None:
    path = tmp_path / "capture.jsonl"
    writer = CaptureWriter(path)
    client = TestClient(create_app(store=TraceStore(), capture=writer))
    client.post("/v1/traces", json=official_json_example())
    client.post("/v1/traces", content=b"junk", headers={"content-type": "text/plain"})
    writer.close()

    [captured] = read_capture(path)  # the rejected request is not saved
    assert captured.content_type == "application/json"
    assert json.loads(captured.body) == official_json_example()


# --- end to end ----------------------------------------------------------------


@pytest.fixture
def live_server() -> Iterator[tuple[str, TraceStore]]:
    store = TraceStore()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(create_app(store=store), host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline, "server did not start"
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}", store
    server.should_exit = True
    thread.join(timeout=5)


def test_real_exporter_end_to_end(live_server: tuple[str, TraceStore]) -> None:
    url, store = live_server
    provider = TracerProvider(resource=Resource.create({"service.name": "e2e"}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{url}/v1/traces")))
    tracer = provider.get_tracer("e2e")
    with tracer.start_as_current_span("agent", attributes={"session.id": "conv"}):
        with tracer.start_as_current_span("tool"):
            pass
    provider.shutdown()  # flushes the batch processor

    [run] = store.runs()
    assert {s.name for s in run.spans.values()} == {"agent", "tool"}
    assert run.session_id == "conv"
    assert run.root is not None and run.root.resource_attributes["service.name"] == "e2e"
