from pathlib import Path

from fastapi.testclient import TestClient

from loopview.app import create_app


def test_health() -> None:
    client = TestClient(create_app())
    assert client.get("/api/health").json()["status"] == "ok"


def test_serves_built_ui(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>built ui</html>")
    client = TestClient(create_app(static_dir=tmp_path))
    assert "built ui" in client.get("/").text


def test_placeholder_when_ui_not_built(tmp_path: Path) -> None:
    client = TestClient(create_app(static_dir=tmp_path))
    assert "has not been built" in client.get("/").text


def test_does_not_trace_itself_into_itself(monkeypatch) -> None:
    """With OTEL_* set (as users do for their agents), FastAPI must not export
    loopview's own requests to loopview: every received batch would create more."""
    import opentelemetry.trace

    from loopview.store.memory import TraceStore

    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://127.0.0.1:9/v1/traces")
    before = opentelemetry.trace._TRACER_PROVIDER
    store = TraceStore()
    with TestClient(create_app(store=store, static_dir=Path("missing"))) as client:
        for _ in range(3):
            client.get("/api/runs")
    assert store.runs() == []
    assert opentelemetry.trace._TRACER_PROVIDER is before  # no global provider installed
