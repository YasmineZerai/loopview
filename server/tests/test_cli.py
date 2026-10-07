"""The `loopview` command: the browser opens only on a server that actually started."""

import socket
import threading
import time

import pytest
import uvicorn

from loopview import cli
from loopview.app import create_app


@pytest.fixture
def opened(monkeypatch):
    urls: list[str] = []
    monkeypatch.setattr(cli.webbrowser, "open", urls.append)
    return urls


def test_taken_port_does_not_open_the_browser(opened, capsys):
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen()
        port = taken.getsockname()[1]

        with pytest.raises(SystemExit):
            cli.main(["demo", "--port", str(port)])

    assert opened == []
    assert "--port" in capsys.readouterr().out


def test_browser_opens_once_the_server_listens(opened):
    app = create_app()
    server = cli._Server(
        uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning"),
        app.state.hub,
        "http://127.0.0.1:4318",
    )
    thread = threading.Thread(target=server.run)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not opened and time.monotonic() < deadline:
            time.sleep(0.05)
    finally:
        server.should_exit = True
        thread.join(timeout=10)

    assert opened == ["http://127.0.0.1:4318"]
