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

All recorded with `claude-haiku-4-5-20251001`. `react_anthropic` and `flagship` use
extended thinking, so they include the model's reasoning. Re-record with
`examples/capture.py`.
