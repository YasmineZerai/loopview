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
