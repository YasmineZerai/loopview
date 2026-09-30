"""Command line entry point: `loopview`.

argparse (standard library) instead of click/typer: we only need a few flags,
so an extra dependency is not worth it.
"""

import argparse

import uvicorn

from loopview import __version__
from loopview.app import create_app

# 4318 is the standard OTLP/HTTP port, so exporters work with only an endpoint change.
DEFAULT_PORT = 4318


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="loopview", description="Watch your AI agents run as a live graph."
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="interface to bind (default: localhost only)"
    )
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help=f"port (default: {DEFAULT_PORT})"
    )
    parser.add_argument("--version", action="version", version=f"loopview {__version__}")
    args = parser.parse_args(argv)

    print(f"loopview {__version__}")
    print(f"  UI:            http://{args.host}:{args.port}")
    print(f"  OTLP endpoint: http://{args.host}:{args.port}/v1/traces")
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
