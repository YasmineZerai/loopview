# loopview

Watch your AI agents run as a live graph, from any OpenTelemetry trace.

> Work in progress. This README will be completed in milestone M9.

## Development

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 22+.

```sh
# build the UI into the Python package
cd ui && npm install && npm run build

# start the server (UI and OTLP endpoint on http://127.0.0.1:4318)
cd ../server && uv run loopview
```

For UI work with hot reload, keep the server running and run `npm run dev` in `ui/`.
Vite forwards `/api` and `/v1` to the server.

Tests:

```sh
cd server && uv run pytest
cd ui && npm test
```

## License

Apache-2.0
