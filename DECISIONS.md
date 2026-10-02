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

## D12. One decoding path for OTLP protobuf and JSON
- **Chosen:** parse OTLP/JSON into the same protobuf message as the binary encoding, after rewriting hex trace and span ids to base64. Then one function turns the message into `RawSpan`s.
- **Rejected:** a separate hand-written JSON decoder.
- **Why:** OTLP/JSON (spec v1.11.0) is the standard protobuf JSON mapping except for the hex ids. Protobuf already handles camelCase keys, integer enums, int64 as strings and unknown fields. That leaves one path to test instead of two that could drift apart.

## D13. Capture files store raw requests, not decoded spans
- **Chosen:** one JSONL line per export request: arrival time, content type, and the body after gzip is undone (JSON kept as JSON so it is readable, protobuf as base64). The same format serves persistence (`--persist`), test fixtures and the demo recording.
- **Rejected:** storing decoded spans.
- **Why:** a newer loopview can re-decode old captures, fixtures replay byte for byte through the real receiver, and arrival timing is kept for liveness tests.

## D14. Ring buffer evicts the least recently updated run
- **Chosen:** an `OrderedDict` of runs moved to the end on every update. When it is full, drop from the front. Sessions are derived on demand, with no second index.
- **Why:** a long run that is still receiving spans must not be evicted just because it started early. Deriving sessions on demand avoids keeping an index in sync with eviction, and it is cheap for a few hundred runs.

## D15. No locks in the store
- **Why:** the receiver is `async def`, so every store update runs on the single asyncio event loop and updates never overlap. If blocking work is ever moved to threads, this needs revisiting.

## D16. Error responses are plain JSON, not a protobuf `Status`
- **Deviation:** the OTLP spec says error bodies should be a protobuf `google.rpc.Status`. We return FastAPI's JSON error body with the right status code (400/413/415).
- **Why:** exporters decide whether to retry from the status code alone, and building `Status` would need `googleapis-common-protos` for no user-visible gain.

## D17. Span timestamps can tie (found in M1)
- **Finding:** on Windows, the Python SDK clock is coarse enough that a parent and its child can have identical start times.
- **Consequence (as implemented in M4):** transitions only compare siblings in the same scope, never a parent with its child, so parent/child ties don't matter. Among siblings, A precedes B when A's end is less than or equal to B's start, so a tie counts as sequential, not parallel. Steps are sorted by (start, span id) so the output is deterministic.

## D18. Examples share one uv project
- **Deviation from the brief:** one `examples/pyproject.toml` instead of one per example.
- **Why:** one `uv sync` runs every example and the capture script, and the examples share most dependencies. loopview and loopview-sdk are editable dependencies there, so `capture.py` can run the server in-process (stopping a `uv run` child process is unreliable on Windows).

## D19. Fixtures are captured through the real receiver
- **How:** `examples/capture.py` runs a loopview server in a thread with persistence on, runs the example against it, and stops. Fixtures are exactly what each framework sent over the wire.
- **Model:** `claude-haiku-4-5-20251001` (cheapest current model), set in `.env`, never hardcoded.

## D20. GenAI spec pinned to commit bcc7f9c (2026-09-29)
- The GenAI conventions live in `open-telemetry/semantic-conventions-genai`, with no tagged release yet. The adapter also reads the older shape (per-message events, `gen_ai.system`) that existing instrumentations still emit.

## D21. One Step per span, graph nodes by key
- **Chosen:** every span becomes exactly one Step: nothing dropped, nothing invented except inferred running parents. A graph node is all Steps that share a `key` (scope path + name), which gives loop counters for free.
- **Rejected:** separate Agent/Node/ModelCall/ToolCall collections. One list with a `kind` keeps the UI code and the live deltas simple.

## D22. One rule for transitions
- **Rule:** within one scope, A leads to B when A ended before B started and no step sits between them (the transitive reduction of "happens before").
- **Why:** sequence, parallel fan out and fan in, loops and handoffs all come out of it, and it needs nothing from the framework. A loop is an edge to a node whose key appeared no later than the source's. Delegate and return edges connect a scope's owner to its first and last steps; the UI shows those by containment instead of drawing them.
- **Tested:** each shape on synthetic steps, and on all four real fixtures.

## D23. LangGraph nodes from OpenInference metadata
- The LangChain instrumentor copies LangGraph's metadata onto spans. A span whose `langgraph_node` equals its name is a node. Other spans inside a node (routing functions, parsers, runnable wrappers) are kept but hidden. A subgraph span nested directly in the node that runs it is collapsed into that node. A node that contains other flow steps is promoted to a group (agent).

## D24. A run's session is the outermost span's
- Nested agents (Pydantic AI) carry their own `gen_ai.conversation.id`. A run's session is the one on the shallowest span, computed on demand because spans arrive children first.

## D25. Inferred running parents, and a provisional root
- A span whose parent hasn't arrived means the parent is running. The parent gets an inferred step, named from what the child knows (adapter `infer_parent`) or after the service. Before the root arrives, all parentless inferred steps hang under the earliest one, because a trace has exactly one root. After 30 s with no new data, a run is treated as finished.

## D26. loopview-sdk and unclassified starts
- The SDK posts span starts (OTLP/JSON, no end time) to `/v1/loopview/span-starts`. A start report is kept until the ended span replaces it.
- OpenInference sets all attributes at span end, so at start a span is only a name. Such a start is shown as a running node only if it is a direct child of a container (the root or an agent). Deeper ones (plumbing) stay hidden until they end. At start time, position is the only reliable clue.

## D27. Live transport sends deltas
- Every 100 ms the hub re-normalizes the runs that changed and sends one event per run: the run info, only the steps whose JSON changed, and all transitions (small). Events are idempotent upserts, so the browser can fetch a snapshot and subscribe in any order.

## D28. Layout: loops are not given to ELK; the camera fits ELK's bounds
- Back edges (loops) are left out of the layout and drawn as arcs. With them, ELK's cycle breaking sometimes placed a later step first. Without them, the layout reads left to right in the order steps first ran.
- The view fits to the bounds ELK computed, not to measured DOM nodes. Right after a layout, React Flow hasn't measured new nodes yet, and fitting to them framed the old graph.
- Layout depends only on structure (`structureKey`), so it doesn't rerun on status changes.

## D29. Colour by innermost agent; state colours separate
- Each agent gets its own hue: its group, its nodes, its timeline lane. State uses a separate set, the same everywhere: white glow for running, green for success, red for error. Agent hues exclude red and green.

## D30. UI dependencies
- `@xyflow/react` (graph canvas), `elkjs` (nested layout, in a Web Worker), `zustand` (small store; React Flow already uses it), `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (fonts bundled, no CDN: local-first). Dev only: `playwright` for screenshot reviews, driving the system's Edge or Chrome so no browser download is needed.
- No icon, JSON viewer or animation library: a few inline SVG icons, a small recursive JSON view, SVG `animateMotion` for particles.

## D31. Replay and live share one model
- The UI builds the graph from the normalized run at a moment `t` (`buildGraph(run, t)`). Live is `t = infinity`; replay advances `t` on each animation frame. Particles and tool flashes fire when an edge's or a tool's count goes up, which works the same way live and in replay.

## D32. Thinking is a message part of its own
- **Chosen:** a `reasoning` part type in the schema, next to text and tool calls. The GenAI adapter maps the spec's `reasoning` part to it. The demo agents run with extended thinking (Claude Haiku 4.5: `budget_tokens` 1024; the supervisor stays without thinking because structured output forces a tool call, which thinking doesn't allow).
- **OpenInference gap:** the LangChain instrumentor drops thinking blocks from the flattened `llm.output_messages` attributes, but keeps them in the raw `output.value`. The adapter searches that raw output for `thinking`/`reasoning` content blocks rather than relying on one exact layout.
- **Note:** without interleaved thinking, Claude thinks at the start of a turn, not after each tool result, so only the first call of an agent's loop carries thinking.

## D33. An activity feed, not only a details panel
- **Problem:** after the first user test, tool arguments, results, model text and thinking were all captured but only reachable by clicking a node. Users read a run as a story, not node by node.
- **Chosen:** a feed on the right with every model call (thinking, reply as Markdown, requested tool calls) and tool call (arguments, result or error), labelled with its agent and node, in time order, on the same clock as the graph. Hover or click links it to the graph. On a timestamp tie, a tool result comes before the model call that reads it.
- **Markdown:** a small renderer that builds React elements (no raw HTML), so model output can't inject markup. No dependency.

## D34. Light theme by default, tokens for everything
- **Chosen:** light by default, after user feedback; dark one click away, remembered per browser. Every colour is a CSS variable redefined under `[data-theme='dark']`, so components never name a colour. Agent hues stay the same in both; text drawn in a hue is mixed darker on light backgrounds to stay readable. SVG marker colours can't use CSS variables, so the graph passes them per theme.

## D35. Timeline hidden by default
- **Chosen:** the playback bar and timeline are a dock that opens on demand (`t` or the floating control); a small floating control keeps play/pause and the time visible. The replay clock lives in the app, not in the dock, so replay keeps running while the dock is hidden. The graph re-frames whenever its canvas changes size (panels, dock, window).

## D36. Calls readable inside the graph: expandable cards
- **Problem:** with details in a side feed and a panel, reading a step still meant looking away from the graph.
- **Chosen:** every card with model or tool calls can expand in place to show them (thinking, replies, tool arguments and results), split by run when the node ran several times, on the same clock as the graph. The feed and the cards share one set of call views (`CallViews.tsx`), so a call reads the same everywhere.
- **Fixed size:** an expanded card is 400 x 380 and scrolls inside, so the layout changes once when a card opens, not every time text arrives. Which cards are open is part of the layout key. Loop arcs use the cards' real tops (`useInternalNode`) so they pass over tall cards instead of through them.

## D37. A hosted demo, built from the same UI
- **Chosen:** `vite build --mode pages` produces a static site that reads recorded runs from JSON files instead of a server, published to GitHub Pages by a workflow. The runs are normalized from the committed fixtures by the real server code during the CI build, so the demo can't drift from what the server would show. In this mode the API layer reads files, live features (SSE, import, export) are off, and the flagship run autoplays.
- **Why:** a link people can open in a browser, with nothing to install, is the best first impression for a developer tool. One UI codebase, two builds, so the demo is always the real thing.
- **Rejected:** hosting a live server (costs money, needs care) and a video only (can't be explored).
