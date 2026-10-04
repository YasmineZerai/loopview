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
| `failing_tools_pydantic.otlp.jsonl` | `examples/failing_tools_pydantic.py` | pydantic-ai-slim 2.52.0, fastmcp-slim 4.0.10 (in-process MCP server) |

All recorded with `claude-haiku-4-5-20251001`. `react_anthropic` and `flagship` use
extended thinking, so they include the model's reasoning. Re-record with
`examples/capture.py`.

`mcp_tools_study` is the one fixture with many runs: the 20 tasks share a session, and one
more run holds only the MCP connection, which this recording opened before the first task (the
script now connects inside each task). It was recorded with `--persist`, which writes the same
format. It is real GitHub content, so it is large (10 MB); the hosted demo loads its runs only
when they are opened.
