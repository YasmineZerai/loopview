# Contributing

Thanks for looking. Issues and pull requests are welcome.

## Set up

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 22+.

```sh
cd ui && npm install && npm run build   # the server serves the built UI
cd ../server && uv sync && uv run loopview demo
```

For UI work, keep the server running and run `npm run dev` in `ui/`: Vite serves the UI with hot reload and forwards `/api` and `/v1` to the server.

## Checks

The same checks run in CI on every push.

```sh
cd server && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd ui && npm run lint && npm test && npm run build
cd sdk && uv run pytest
```

## Where things live

- `server/src/loopview/ingest`: OTLP decoding.
- `server/src/loopview/store`: runs, sessions, capture files.
- `server/src/loopview/normalize`: the schema, one adapter per convention, transitions. Supporting a new convention means adding one adapter in `normalize/adapters/` and registering it in `adapters/__init__.py`.
- `ui/src/graph`: turning a normalized run into a graph, and its layout.
- `ui/src/components`: the interface.
- `DECISIONS.md`: why things are the way they are. Add an entry for any significant choice.

## Fixtures

Tests run against traces recorded from real framework runs, never hand-written spans, because the point is to handle what frameworks actually emit. To add a framework: write a small example in `examples/`, record it with `examples/capture.py` (needs a model API key), and add tests against the new file in `fixtures/`.

## Style

Small, readable code over clever code, with comments where the reason isn't obvious. Don't add a dependency without saying why in the pull request.
