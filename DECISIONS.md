# Decisions

One short entry per significant decision: what was chosen, what was rejected, and why.

## D1. OpenTelemetry as the only integration contract
- **Chosen:** accept OTLP traces, support the OTel GenAI and OpenInference conventions, show any other span generically.
- **Rejected:** per-framework callbacks or SDK hooks.
- **Why:** most agent frameworks already emit OTel spans. One contract covers them all, and a new convention only needs one new adapter.

## D2. Spec versions
- **OTel GenAI:** in June 2026 (semconv v1.42.0) it moved to its own repo, `open-telemetry/semantic-conventions-genai`. It is still "Development" and has no tagged release, so we pin a commit SHA, recorded here at M3.
- **OpenInference:** the spec has no version number, so we pin the `openinference-instrumentation-*` package versions used to capture fixtures.
- **Why:** both conventions are still changing. Pinning makes it clear what the adapters were written against.

## D3. OTLP over HTTP first, gRPC later
- **Chosen:** OTLP/HTTP only (protobuf and JSON) on port 4318.
- **Rejected for now:** OTLP/gRPC on 4317.
- **Why:** gRPC needs `grpcio`, a heavy native dependency. The docs tell users to pick the HTTP exporter. gRPC is on the roadmap.

## D4. One process, one port
- **Chosen:** FastAPI serves the OTLP endpoint, the API, the live stream and the built UI, all on 4318. `--port` handles clashes with a local Collector or Phoenix.
- **Rejected:** a separate UI port or a separate frontend server.
- **Why:** one command, one URL to remember, and a single Python wheel that includes the built UI.

## D5. Repo layout: `server/src/loopview`, UI built into the package
- **Chosen:** a `src/` layout. Vite builds into `server/src/loopview/static/`, which is gitignored but included in the wheel (verified with `uv build`).
- **Why:** this is what makes `uvx loopview` work without Node on the user's machine.

## D6. Fixture capture after the receiver (milestones M1/M2 swapped)
- **Chosen:** build the OTLP receiver first, then capture fixtures through it as raw request bodies with their arrival times.
- **Why:** fixtures are then exactly what the receiver sees on the wire, including batching timing, so the liveness logic can be tested against reality.

## D7. Server-Sent Events for live transport
- **Chosen:** SSE.
- **Rejected:** WebSocket.
- **Why:** data only flows server to browser. SSE reconnects automatically and needs no new dependency. Replay controls run in the browser.

## D8. ELK for graph layout
- **Chosen:** `elkjs`, run in a Web Worker.
- **Rejected:** dagre.
- **Why:** multi-agent groups are nested graphs, and ELK lays those out natively. dagre's support for nested groups is weak and it is barely maintained. Cost: a larger bundle and asynchronous layout.

## D9. Replay uses span timestamps, not arrival times
- **Why:** arrival times include the exporter's batching delay (5s by default). Span start and end times show what really happened, so replay is more accurate than the live view.

## D10. Multi-agent example: Pydantic AI instead of the OpenAI Agents SDK
- **Why:** the project is developed with an Anthropic key only. Pydantic AI runs on Anthropic and emits OTel GenAI spans natively. That also gives us a real multi-agent fixture in the GenAI convention, not only OpenInference.

## D11. Small tooling choices
- **argparse** over click/typer: we only need a few flags, so no extra dependency.
- **uvicorn** without the `[standard]` extras: we don't need websockets, uvloop or file watching.
- **httpx2** as a dev dependency: current Starlette's test client asks for it and deprecates `httpx`.
- **oxlint** (the Vite template default) for UI linting: fast and needs no config.
- **License:** Apache-2.0 (includes a patent grant, matches OpenTelemetry).
