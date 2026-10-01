"""Capture a real trace fixture from one example.

Runs a loopview server in a background thread that persists every OTLP request
to fixtures/<name>.otlp.jsonl, runs the example against it in a subprocess, then
stops the server. The fixture is exactly what the framework sent over the wire.

The server runs in-process (loopview is an editable dependency of this project)
so there is no child server process to clean up, which is unreliable on Windows.

Usage (from examples/):  uv run python capture.py react_anthropic
                         uv run python capture.py demo.flagship
"""

import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import uvicorn

from loopview.app import create_app
from loopview.store.capture import CaptureWriter
from loopview.store.memory import TraceStore

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: capture.py <example module, e.g. react_anthropic or demo.flagship>")
    module = sys.argv[1]
    fixture = FIXTURES / f"{module.split('.')[-1]}.otlp.jsonl"
    fixture.unlink(missing_ok=True)
    port = free_port()

    writer = CaptureWriter(fixture)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(store=TraceStore(), capture=writer),
            host="127.0.0.1", port=port, log_level="warning",
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)

    try:
        env = {**os.environ,
               "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": f"http://127.0.0.1:{port}/v1/traces"}
        subprocess.run([sys.executable, "-m", module], env=env, check=True,
                       cwd=Path(__file__).parent)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        writer.close()

    lines = fixture.read_text().count("\n")
    print(f"\ncaptured {lines} OTLP requests into {fixture.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
