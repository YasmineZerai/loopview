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

## D38. Token usage: read what the conventions say, never invent it
- **Chosen:** a `usage` object per model call (input, output, cache read, cache write, reasoning), replacing the old input/output pair. Each adapter reads its convention's names: GenAI (`gen_ai.usage.*`, plus Pydantic AI's own `gen_ai.usage.details.cache_*` names), OpenInference (`llm.token_count.*`, falling back to LangChain's raw `usage_metadata` for reasoning and cache tokens, which the instrumentor doesn't copy into attributes). A count that isn't in the trace stays empty. The findings per framework are in [docs/cost-data.md](docs/cost-data.md).
- **Input includes cache tokens**, as both specs say. Anthropic's own `input_tokens` excludes them, so the hand-instrumented example adds them back.
- **Fixtures re-captured:** the flagship analysts now share a long, cached handbook as their system prompt, so the recorded runs contain real cache writes and reads to test against.

## D39. The cost split: estimate, then scale to the reported totals
- **Problem:** providers report how many tokens a call used, not which part of the prompt they came from.
- **Tokenizer:** characters divided by 4 for prose and 3 for JSON. Measured against the reported counts it lands within about 15% on prose. **Rejected:** a real tokenizer. Anthropic doesn't publish one for Claude, `tiktoken` is OpenAI's and would add a dependency without being right either, and the counting endpoint costs an API call per message.
- **Segments:** system prompt, tool definitions, history, tool results, new input (after the last assistant message), cache reads, cache writes, thinking, reply. Each estimate is scaled so the segments add up exactly to the reported total.
- **Unattributed rule:** scaling may stretch the estimate by at most 1.25x (`MAX_STRETCH`). If the recorded content explains less than 80% of the reported count, the rest is shown as "unattributed" instead of being spread over the known segments. Hiding a big gap inside "history" would look precise and be wrong.
- **Tool prompt (provider):** with tools, Anthropic adds a system prompt the trace never contains (496 tokens on Claude Haiku 4.5). Before this segment, unattributed was about 60% of the input on calls with tools; after, about 10%. The size comes from the pricing file, per model, from Anthropic's docs.
- **Cache:** cached tokens are a prefix of the prompt, so cache reads and writes are carved from the front, in prompt order (tool prompt, tool definitions, system, history...).
- **Thinking:** taken from the reported reasoning tokens when present; otherwise estimated from the thinking text like the rest.
- **Without content**, the call's whole cost is unattributed: the total is known, the split isn't.

## D40. Cost colours: one family of hues per group
- **Problem:** ten distinct segment colours that also stay clear of the eight agent hues and the state colours (green, red) proved impossible: validated palettes either collided with an agent hue or failed colour-blind separation.
- **First tried:** a grey ramp, one shade per group, to stay clear of the agent hues. The user found it dull and hard to read.
- **Chosen:** a family of hues per group, a shade per segment: instructions indigo (tool prompt, tool definitions, system), conversation blue (history, tool results, new input), cache green (reads, writes), thinking amber, reply rose, and a hatched grey for unattributed, which is "unknown", not a category. Each theme has its own shades. The hues sit close to some agent hues, so the two never share a mark: branches to agents and steps carry the agent's colour, and segment colours appear only in the stacked bars and the leaves, always with a label.

## D41. Where the cost is computed
- **Chosen:** the server computes each call's split once, when normalizing (`cost/split.py`, pure functions, tested with pytest). The UI only adds up the calls finished by the current moment (`costModel.ts`), so live view, replay, per agent and per step all come from the same numbers.
- **Why:** the split needs the full message content, which the server already has; summing at a moment in time is the same model as `buildGraph(run, t)`. **Rejected:** computing everything in the browser (the content would be parsed twice and Python's tests couldn't cover it).

## D42. Prices in an editable JSON file
- **Chosen:** `cost/pricing.json`, one entry per model family with input, cache write (5 minutes), cache read and output prices per million tokens, the tool prompt size, a source URL and the date checked. A model ID matches the longest family name it starts with, so dated IDs (`claude-haiku-4-5-20251001`) need no entry of their own. `--prices FILE` merges a user's file over it.
- **Why:** prices change; a JSON file can be checked and edited by anyone without touching code, and the source and date make every number auditable. Unknown models get no price rather than a guess: they show tokens only.
- **OpenAI** (added after the first release): standard-tier prices from OpenAI's pricing page. OpenAI caches automatically and doesn't charge to write the cache, so `cache_write` equals the input price; models without a cached price get `cache_read` equal to input, so no discount is invented. The page lists some legacy models only by dated ID; their aliases (`gpt-4-turbo`, `gpt-3.5-turbo`) are keyed by name. No tool prompt size: OpenAI doesn't document one.

## D43. Cost drawn as a tree whose branches are as thick as the money
- **Problem:** the first version was a side panel of bars and tables, the second an icicle of grey blocks under the graph. The user found both read like a report, not like the rest of loopview, which is graphic.
- **Chosen:** a tree drawn left to right, taking the whole canvas (<kbd>c</kbd> switches between graph and cost). The trunk is the run; it branches into agents, then steps. Every bar is as tall as its cost and the branches leaving it stack up to exactly its height, so the money can be followed from the trunk to every leaf (a Sankey drawn as a tree). The trunk and each step are stacked by what their tokens were spent on; clicking a step opens it into one leaf per segment. The most expensive step starts open. Hovering keeps the hovered branch lit and fades the rest; double-clicking a step shows its card in the graph.
- **Layout:** pure functions in `costTree.ts` (tested): leaves stacked top to bottom with room for their label, each parent centred on its children, branches straight for a while before they curve so labels sit on a calm band. Plain SVG, no chart library.
- **Rejected:** a sunburst (angles are hard to compare, labels don't fit), cost badges on the graph cards (good for one step, poor for comparing many), and the icicle (correct, but blocks don't read as a tree).

## D44. The Tools tab: definitions, and errors only from what the trace says
- **Problem:** static linters score tool descriptions, but they can't show how a tool behaves in real runs: how often it fails, what the agent does next, which tools it mixes up, which ones it is offered and never uses. What each framework records is in [docs/tool-data.md](docs/tool-data.md).
- **Where:** `tools/report.py`, pure functions over normalized runs, tested with pytest on synthetic runs and the fixtures. `GET /api/tools` (all runs, `?session=` or `?runs=`) recomputes on every request, which is cheap at a few hundred runs.
- **Definitions:**
  - *Tool call:* a finished `tool_call` step.
  - *Error:* the trace marks the call as failed: span status ERROR (with or without an exception event), or an MCP result with `isError: true`.
  - *Canonical arguments:* JSON with sorted keys, so identical calls compare equal.
  - *Agent:* the nearest agent above the call, by name, within its run.
  - *Next move after an error:* read from the agent's turns whose model call started after the failed call ended. *Blind retry*: the same tool with identical arguments; *fixed*: the same tool with other arguments (and whether that worked); *switched*: another tool, recorded as a pair; *gave up*: no further tool call by that agent in the run. Calls to tools that also failed in the failed call's own turn are skipped, since they are those tools' own retries.
  - *Error group:* the message with UUIDs, hex ids, quoted values longer than 12 characters and numbers replaced by placeholders, cut at 200 characters.
  - *Confused pair:* a switch from A to B, counted across runs, shown from two occurrences.
  - *Offered tools:* the definitions recorded on model calls. With none in the runs, the tool list is "not recorded" and nothing is said about unused tools.
  - *Never called:* offered at least once, called zero times. *Definition cost (estimate):* the definition's JSON length / 4, times the model calls that carried it.
  - *Result size (estimate):* average result length / 4 over successful calls.
- **"Next" is a turn, not the next call** (a change from the first plan). Models request several tools in one turn; the call that starts right after a failure was usually requested before the model saw the error, so counting it would call a parallel call a "fix". A tool call belongs to the agent's latest model call that had *ended* when the tool started: compared with ends, not starts, so it stays right when timestamps tie (D17). An agent with no recorded model calls falls back to its next tool call.
- **Errors are never guessed from the result text in v1.** A tool that returns "Error: not found" as an ordinary result counts as a success. Guessing would need rules per tool and language, and would mark legitimate results ("0 errors found") as failures. A wrong count that looks precise is worse than a known blind spot, which the README states.
- **Rejected:** "next move" across agents (a supervisor recovering for a worker). It needs to know which agent acts for which, which no convention records.

## D45. The Tools tab in the UI
- **A table, not a graph:** the question is "which tools", across many runs, so rows sorted by errors answer it directly. Sorting, the after-error bar and the summary sentence are pure functions (`tools/toolsModel.ts`, tested); the component only draws.
- **After-error colours:** blind retry amber, fixed blue, switched magenta, each validated for contrast and colour-blind separation against both themes' surfaces. "Gave up" is hatched grey, like "unattributed" in the cost view: it is the absence of a move. The legend sits above the table, and every segment has a label in its tooltip.
- **Jump to a step:** `openStep(run, step)` selects the run, opens the card of the node that made the call, and outlines that call in the details panel. A run that isn't loaded yet is fetched first; the graph re-centres on the card for a short while after each new layout, because opening a card changes the layout.
- **Every token number says it is an estimate** (`~`, "est.", "estimated").
- **Hosted demo:** `dump_normalized` writes the report over all fixtures to `tools.json`, so the demo shows the real numbers without a server. With the MCP study (20 runs, 4 MB normalized) the demo no longer downloads every run up front: `index.json` carries each run's RunInfo, and a run's file is fetched when it is opened. Multi-run fixtures are written for the demo only, not into the UI test data.

## D46. loopview never traces itself
- **Found while building the MCP study:** FastAPI 0.142 traces its own requests and, on startup, exports them to the endpoint in `OTEL_EXPORTER_OTLP_*`, the variables users set to point their agents at loopview. With them set in loopview's shell, every batch loopview received produced spans sent back to loopview: 28 runs of its own requests in 3 seconds, growing without end.
- **Chosen:** `create_app` passes `telemetry` with tracing, metrics, logs and auto-configuration off, when the installed FastAPI has that option (older versions don't trace themselves). A test checks that no run appears and no global tracer provider is installed.

## D47. Activity lives in the graph; three main tabs
- **Problem:** the activity feed (D33) put a column of text beside the graph, so reading a run meant looking away from it, and the top bar gave the same weight to views (graph, cost, tools) and to small actions (fit, expand, export).
- **Chosen:** no feed. *Activity* is a toggle in the graph: every card shows its calls (the expanded cards of D36) and the camera follows the card where something is happening, a call running at the current moment or else the last one that started (`graph/activity.ts`, tested). Live and replay use the same rule. With Activity on, the whole graph is framed once per run instead of after every layout, and the camera moves only when the active card changes or the layout moves it, so panning stays possible. A jump from the Cost or Tools tab wins for a moment. On by default, like the feed was.
- **Top bar:** Graph, Cost and Tools are the main tabs (<kbd>g</kbd> <kbd>c</kbd> <kbd>o</kbd>); Activity, Expand and Fit (graph only), Export and the theme are smaller controls on the right.
- **Colour:** each main view has an accent, graph indigo, cost green, tools amber, on its tab, its title and its headline numbers, in both themes. Text in an accent is mixed darker on light backgrounds, like agent hues (D34). Accents stay in the chrome; data keeps its own colours (agents, cost segments, after-error moves).
- **Rejected:** keeping the feed closed by default (the text column was the problem, not its default), and tinted panels everywhere (would compete with the agent hues in the graph).

## D48. Flat agent loops get model and tools nodes
- **Problem:** LangGraph records a span per graph node, so its agents arrive as `model` and `tools` nodes and the graph shows the loop. The GenAI conventions (Pydantic AI, the Anthropic and OpenAI SDKs, hand instrumented code) record only `invoke_agent` with `chat` and `execute_tool` spans directly under it. Model and tool calls are never graph nodes (D21), so a single GenAI agent was one card holding every call, while the same loop in LangGraph was a readable graph.
- **Chosen:** a pass after linking (`normalize/loop_nodes.py`, tested) adds what the convention leaves out, for agents with tool calls directly inside them: a `model` step per model call and a `tools` step per turn, holding the tool calls that model call asked for (the turn rule of D44: a tool call belongs to the latest model call that had ended when it started). The one transition rule (D22) then draws model -> tools -> model with a loop counter, as for LangGraph. A sub-agent run by a tool moves inside that turn's `tools` step, which becomes a group, coloured like its agent.
- **Synthetic, and marked so:** these are the first steps no span stands for, beyond inferred running parents (D25), so they carry `synthetic: true` and D21's rule becomes "every span is exactly one step; synthetic steps are added only for flat agent loops". The Tools report skips them when it looks for a call's agent.
- **Left alone:** agents with no tool calls (no loop to show; they stay one card), and agents whose calls already sit in flow nodes (LangGraph).
- **Rejected:** building these nodes in the UI. Every place that maps a call to its card (graph, details, cost, activity, jumps) would need the rule; in the normalizer they are ordinary steps and everything downstream works unchanged.

## D49. Connecting any agent: `connect()`, and recordings per integration
- **Problem:** loopview only reads OpenTelemetry, but what arrives depends on each integration: which spans exist (model SDK instrumentation records model calls only, not the user's loop or tools), which naming standard the attributes follow, and whether content is switched on (OpenTelemetry's own OpenAI instrumentation sends it as log events unless opted in).
- **Chosen:** `loopview_sdk.connect()`, one call that sets up the exporter, finds every installed instrumentor through the standard `opentelemetry_instrumentor` entry point (OpenInference's first when two cover one library, since it records content and tool definitions; GenAI libraries only), switches on content capture without overriding a user's settings, and flushes at exit. `loopview_sdk.agent(name)` puts an agent span around a hand-written loop. The server still reads both naming standards, so agents that never install the SDK, in any language, keep working.
- **Rejected:** writing our own instrumentation per framework (OpenInference and others already maintain it), and renaming attributes in the SDK (would help only Python users of the SDK; the server's adapters help everyone).
- **Recordings:** `examples/compat/`, one agent per integration on the same task, recorded as is and wrapped in `agent()`. A separate uv project, unlike D18: these packages pin versions that clash with the main examples (CrewAI clashes even with them, and gets its own). Found by recording: plain SDK loops show no tool calls (fixed next by deriving them from the conversation), and without a wrapping span every model call is a run of its own.

## D50. Making hand-written loops and other frameworks readable
Found by recording each integration (D49), fixed in order of impact:
- **Tool calls rebuilt from the conversation** (`normalize/derived_tools.py`). Model SDK instrumentation records model calls only; a user's tools are their own functions. A model call's output asks for tools (id, name, arguments) and the next call's input carries the results (same id), so each request becomes a synthetic tool call: from the end of the asking call to the start of the answering one, with its result. Failed only when the result is flagged (Anthropic's `is_error`), never from its text (D44). Runs with any real tool span are left alone: a request without a span there is deliberate (structured output, such as the flagship's `Plan`, is a tool call never run). Hence `@loopview_sdk.tool` is all of a loop's tools or none.
- **Calls with nothing around them** get a synthetic agent named after the service, so a run is never an empty graph. **A plain step running a whole loop** (several model calls and tools, under a generic span) is treated as its agent; one model call and its tools (the OpenAI Agents SDK's `turn`) is a single step and stays one.
- **OpenInference's Anthropic instrumentation** keeps one tool result per message, drops `is_error`, and repeats tool calls as `tool_use` content blocks: results and flags are read from the raw request, as thinking is (D32), and the repeats are skipped.
- **`connect()` falls back** when the preferred instrumentor doesn't support the installed library (CrewAI pins an Anthropic SDK older than OpenInference's instrumentor accepts; OpenLLMetry's fits), and says when none does, instead of skipping silently.
- **Smaller:** prices match routed model IDs (`anthropic/...`, Bedrock, Vertex); a chain directly inside a span of the same name is one step; agent names come from `graph.node.id` and UUIDs are dropped from span names; OpenLLMetry's cache token name is read.

## D51. A guided demo: curated examples, a tour, and the Tools tab's findings
- **Problem:** the hosted demo listed every fixture: compatibility recordings of the same weather task and the MCP study's 21 runs ("task 01" to "task 20"), so the good examples were lost in the list, nothing said what an agent was asked to do, and first-time visitors didn't know where to click.
- **Chosen:** `dump_normalized --index` writes only a curated list (`DEMO_RUNS`), each with a title, framework, description, the exact prompt from the example's source and what to look for. The MCP study's runs are written but not `listed`: they feed the Tools tab, and its links still open them, with their task as the prompt. A tour (the first thing every visit shows, and again from a Tour button) dims the page and lights up one part at a time, each explained as a short legend in the graph's own colours. It sets the scene each step describes and then demonstrates it (opens a card, opens its details, clicks Expand, zooms and presses Fit, switches Activity on, opens the timeline and jumps through the run) while the visitor watches; the visitor's own settings come back when it ends. Replays default to 0.5x (speeds 0.5x, 1x, 2x), slow enough to follow. The Tools tab opens with findings no single trace gives: how often the agent changed course after an error, what unused tool definitions cost, and the heaviest tool result.
- **Rejected:** a tour library (one small component does it, with no dependency) and keeping the descriptions in the UI (the server script already chooses the runs; one list holds both).

## D52. Activity opens only the active cards, and zooms in on them
- **Problem:** with Activity on, every card opened at once and the camera only panned to the running one at the current zoom, so a long run became a wall of open cards, mostly too small to read.
- **Chosen:** the active cards (`activeCardKeys`) are every card with a call running at that moment, several when branches run in parallel, or else the card of the last call, so a card stays open through the short gaps between calls. Only they open, and each closes when its calls are done. The camera frames them, at least 1,000 × 600 graph units so one small card isn't blown up. A zoom picked by hand (wheel or pinch) is kept while following, until the run or Activity changes. Expand all works with Activity on. Clicking a card selects it and zooms to it; while a card is selected, the camera stops following, because the user is reading. Closing an active card with › keeps it closed while it stays active.
- **Rejected:** following one card only (parallel branches would leave all but one off screen), and closing cards after a delay (the gaps between calls are short, and a fixed delay would lag fast runs).
