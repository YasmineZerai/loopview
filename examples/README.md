# Examples

Small agents in different frameworks, each sending OpenTelemetry traces to
loopview. They share one uv project (one `uv sync` gets them all) and read
`../.env` (copy `../.env.example`).

| Example | Framework | Convention | Shows |
|---|---|---|---|
| `react_anthropic.py` | Anthropic SDK, hand-rolled loop | GenAI, manual spans | one agent, model calls, tools |
| `langgraph_router.py` | LangGraph | OpenInference | conditional routing, a tool loop, a review loop |
| `multi_agent_pydantic.py` | Pydantic AI | GenAI, built in | delegation to two agents in parallel, a handoff |
| `demo/flagship.py` | LangGraph | OpenInference | everything: supervisor, 3 parallel agents, a failing tool and retry, a critic loop, a handoff |

## Run one against loopview

```sh
cd server && uv run loopview          # in one terminal
cd examples && uv sync
uv run python react_anthropic.py      # in another
uv run python -m demo.flagship
```

`shared.py` holds the whole integration: a TracerProvider with the standard
OTLP/HTTP exporter, plus `loopview-sdk` for start events (set `LOOPVIEW_SDK=0`
to see what plain OpenTelemetry gives you).

Model names come from `ANTHROPIC_MODEL` in `.env`.

## Recording fixtures

```sh
uv run python capture.py react_anthropic      # or langgraph_router, multi_agent_pydantic, demo.flagship
uv run python inspect_fixture.py flagship     # the raw span tree
uv run python inspect_normalized.py flagship  # what loopview makes of it
```

`capture.py` runs a loopview server in-process that saves every OTLP request
to `../fixtures/<name>.otlp.jsonl`, runs the example against it, and stops.
After re-recording the flagship, copy it to
`server/src/loopview/demo_data/flagship.otlp.jsonl` (a test checks they match)
and regenerate the UI test data (see `ui/src/test-data/README.md`).
