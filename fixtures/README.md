# Fixtures

Traces recorded from real runs of the examples, never written by hand: the point
is to handle what frameworks actually emit.

Each file is a loopview capture: one OTLP/HTTP export request per line, exactly
as the receiver got it, with its arrival time. Replaying the lines in order
through the receiver reproduces the run, including the batching timing.

| File | Recorded from | Packages |
|---|---|---|
| `react_anthropic.otlp.jsonl` | `examples/react_anthropic.py` | anthropic 1.9.0, opentelemetry-sdk 1.45.0 |
| `langgraph_router.otlp.jsonl` | `examples/langgraph_router.py` | langgraph 1.2.12, openinference-instrumentation-langchain 0.1.76 |
| `multi_agent_pydantic.otlp.jsonl` | `examples/multi_agent_pydantic.py` | pydantic-ai-slim 2.52.0 (instrumentation format version 5) |
| `flagship.otlp.jsonl` | `examples/demo/flagship.py` | langgraph 1.2.12, openinference-instrumentation-langchain 0.1.76 |
| `failing_tool_anthropic.otlp.jsonl` | `examples/failing_tool_anthropic.py` | anthropic 1.9.0, opentelemetry-sdk 1.45.0 |
| `mcp_tools_study.otlp.jsonl` | `examples/mcp_tools_study.py` against GitHub's MCP server (read-only), 20 tasks | pydantic-ai-slim 2.52.0, fastmcp-slim 4.0.10 |
| `openai_sdk_openinference.otlp.jsonl`, `..._wrapped` | `examples/compat/openai_sdk_openinference.py` (OpenAI SDK on Claude) | openai 3.24.0, openinference-instrumentation-openai 0.1.63 |
| `openai_sdk_otel.otlp.jsonl`, `..._wrapped` | `examples/compat/openai_sdk_otel.py` | opentelemetry-instrumentation-openai-v2 2.4b0, opentelemetry-util-genai 0.4b0 |
| `anthropic_sdk_openinference.otlp.jsonl`, `..._wrapped` | `examples/compat/anthropic_sdk_openinference.py` | anthropic 1.11.0, openinference-instrumentation-anthropic 3.0.1 |
| `anthropic_sdk_openllmetry.otlp.jsonl`, `..._wrapped` | `examples/compat/anthropic_sdk_openllmetry.py` | opentelemetry-instrumentation-anthropic 0.62.4 (OpenLLMetry) |
| `openai_agents_sdk.otlp.jsonl` | `examples/compat/openai_agents_sdk.py` (on Claude via LiteLLM) | openai-agents 0.23.1, openinference-instrumentation-openai-agents 2.5.2 |
| `crewai.otlp.jsonl` | `examples/compat_crewai/weather_crew.py`, with `loopview_sdk.connect()` | crewai 1.15.23, openinference-instrumentation-crewai 1.1.20, opentelemetry-instrumentation-anthropic 0.62.4 |
| `failing_tools_pydantic.otlp.jsonl` | `examples/failing_tools_pydantic.py` | pydantic-ai-slim 2.52.0, fastmcp-slim 4.0.10 (in-process MCP server) |
| `issuescout_team.otlp.jsonl` | one run of issuescout, an app outside this repository (see below) | pydantic-ai 2.55.0, the MCP Python SDK and fastmcp (GitHub, DeepWiki and Context7 servers), opentelemetry-sdk 1.45.1 |

All recorded with `claude-haiku-4-5-20251001`. `react_anthropic` and `flagship` use
extended thinking, so they include the model's reasoning. Re-record with
`examples/capture.py`.

The compat fixtures all run the same task (weather in Lisbon and Atlantis; Atlantis
fails). A plain SDK loop is recorded twice: as is, where every model call is a run of
its own (three runs), and `_wrapped` in `loopview_sdk.agent(...)` (one run). Recorded
from the compat project: `uv run --project compat python capture.py compat.<module> [name]`,
with `COMPAT_WRAP=1` for the wrapped ones.

`mcp_tools_study` is the one fixture with many runs of different tasks: the 20 tasks share a session, and one
more run holds only the MCP connection, which this recording opened before the first task (the
script now connects inside each task). It was recorded with `--persist`, which writes the same
format. It is real GitHub content, so it is large (10 MB); the hosted demo loads its runs only
when they are opened.

`issuescout_team` is the one fixture not recorded from this repository's examples: a real app
that triages bug reports, run 78 times on `anthropic/claude-haiku-5.5` through OpenRouter. One
team run was copied out of that recording with `loopview.devtools.extract_run`, unchanged except
for the user's home folder in stack traces (`--redact`), so it normalizes exactly as it did in
the full recording. The recording itself (144 MB) is not in the repository; its Tools tab report
is, as `issuescout_pilot.tools.json` (written by `loopview.devtools.tools_snapshot`, with links
kept only into the team run). The hosted demo shows that report.
