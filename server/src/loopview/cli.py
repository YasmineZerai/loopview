"""Command line entry point: `loopview`.

argparse (standard library) instead of click/typer: we only need a few flags,
so an extra dependency is not worth it.
"""

import argparse
import logging
import socket
import threading
import webbrowser
from pathlib import Path
from types import FrameType

import uvicorn

from loopview import __version__
from loopview.app import create_app, load_demo_into
from loopview.cost.pricing import merged_pricing
from loopview.live import LiveHub
from loopview.store.capture import CaptureWriter, load_capture
from loopview.store.memory import DEFAULT_MAX_RUNS, TraceStore

# 4318 is the standard OTLP/HTTP port, so exporters work with only an endpoint change.
DEFAULT_PORT = 4318


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="loopview", description="Watch your AI agents run as a live graph."
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=["demo"],
        help="demo: start with a recorded multi-agent run loaded and open the browser",
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="interface to bind (default: localhost only)"
    )
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help=f"port (default: {DEFAULT_PORT})"
    )
    parser.add_argument(
        "--persist",
        type=Path,
        metavar="FILE",
        help="save every received request to this JSONL file and reload it on start",
    )
    parser.add_argument(
        "--max-runs",
        type=int,
        default=DEFAULT_MAX_RUNS,
        help=f"how many recent runs to keep in memory (default: {DEFAULT_MAX_RUNS})",
    )
    parser.add_argument(
        "--prices",
        type=Path,
        metavar="FILE",
        help="JSON file of model prices, replacing the bundled ones (see cost/pricing.json)",
    )
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--version", action="version", version=f"loopview {__version__}")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("asyncio").addFilter(_IgnoreWindowsConnectionReset())
    store = TraceStore(max_runs=args.max_runs)
    capture = None
    if args.persist is not None:
        if args.persist.exists():
            loaded = load_capture(store, args.persist)
            print(f"loaded {loaded} requests from {args.persist}")
        capture = CaptureWriter(args.persist)
    if args.command == "demo":
        load_demo_into(store)

    print(f"loopview {__version__}")
    print(f"  UI:            http://{args.host}:{args.port}")
    print(f"  OTLP endpoint: http://{args.host}:{args.port}/v1/traces")
    if capture is not None:
        print(f"  persisting to: {args.persist}")
    # Flush now: when stdout is a pipe, Python buffers it and the banner would
    # only appear when the server stops.
    print(flush=True)
    open_url = None
    if args.command == "demo" and not args.no_browser:
        open_url = f"http://{args.host}:{args.port}"
    app = create_app(store=store, capture=capture, pricing=merged_pricing(args.prices))
    server = _Server(
        uvicorn.Config(app, host=args.host, port=args.port, log_level="warning"),
        app.state.hub,
        open_url,
    )
    try:
        server.run()
    except SystemExit:
        # uvicorn has logged the reason (usually the port is taken) and exits.
        if not server.started:
            print(
                f"\nloopview could not listen on {args.host}:{args.port}. If another loopview "
                "(or another OpenTelemetry collector) is using that port, stop it or choose "
                "another one with --port.",
                flush=True,
            )
        raise
    except KeyboardInterrupt:
        # uvicorn re-raises Ctrl+C once it has shut down cleanly; that's the
        # normal way out, not an error.
        print("loopview stopped")
    finally:
        if capture is not None:
            capture.close()


class _Server(uvicorn.Server):
    """uvicorn's server, which also ends the live streams as soon as Ctrl+C is
    pressed. Otherwise it would wait for the browser's open event stream, which
    never closes on its own, and then cancel it with a traceback."""

    def __init__(self, config: uvicorn.Config, hub: LiveHub, open_url: str | None = None) -> None:
        super().__init__(config)
        self.hub = hub
        self.open_url = open_url

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets)
        # Open the browser only once the port is ours: if it was taken, the page
        # would show whatever else is listening there.
        if self.started and self.open_url:
            threading.Thread(target=webbrowser.open, args=[self.open_url], daemon=True).start()

    def handle_exit(self, sig: int, frame: FrameType | None) -> None:
        self.hub.close()
        super().handle_exit(sig, frame)


class _IgnoreWindowsConnectionReset(logging.Filter):
    """On Windows, asyncio logs a ConnectionResetError when a browser closes a
    connection abruptly (a known, harmless Python issue). Drop that one record."""

    def filter(self, record: logging.LogRecord) -> bool:
        error = record.exc_info[1] if record.exc_info else None
        return not isinstance(error, ConnectionResetError)


if __name__ == "__main__":
    main()
