# Examples

Small agents in different frameworks, each sending OpenTelemetry traces to
loopview. They share one uv project (one `uv sync` gets them all) and read
`../.env` (copy `../.env.example`).

| Example | Framework | Convention | Shows |
|---|---|---|---|
| `react_anthropic.py` | Anthropic SDK, hand-rolled loop | GenAI, manual spans | one agent, model calls, tools |
| `langgraph_router.py` | LangGraph | OpenInference | conditional routing, a tool loop, a review loop |
| `multi_agent_pydantic.py` | Pydantic AI | GenAI, built in | delegation to two agents in parallel, a handoff |
| `failing_tool_anthropic.py` | Anthropic SDK, hand-rolled loop | GenAI, manual spans | a tool that fails (no price for Berlin) |
| `failing_tools_pydantic.py` | Pydantic AI + an MCP server | GenAI, built in | a `ModelRetry` and an MCP `isError`, and the recovery |
| `mcp_tools_study.py` | Pydantic AI + GitHub's MCP server | GenAI, built in | 20 read-only tasks, then the Tools tab's summary (needs `GITHUB_PERSONAL_ACCESS_TOKEN`) |
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

## The MCP tools study

`mcp_tools_study.py` runs the tasks in `mcp_tools_study_tasks.txt` (20 read-only
questions about public repositories) with one Pydantic AI agent connected to
GitHub's official MCP server, then prints the Tools tab's summary.

```sh
# one command: starts loopview in-process, saves the runs, keeps the UI open
uv run python mcp_tools_study.py --persist mcp_tools_study.jsonl
# or against a loopview that is already running
uv run python mcp_tools_study.py
```

Options: `--server URL` for another MCP server (streamable HTTP), `--token-env NAME`
(`''` for a server without auth), `--tasks FILE`, `--limit N`, `--model NAME`.
Each task is one run, and all runs of a study share a session. Later, reopen the
saved runs with `cd ../server && uv run loopview --persist ../examples/mcp_tools_study.jsonl`.
A recorded study is in `../fixtures/mcp_tools_study.otlp.jsonl`.

## Compatibility recordings (`compat/`)

One small agent per framework and instrumentation, all on the same task, to record
what each really sends: the OpenAI SDK (OpenInference, and OpenTelemetry's own
instrumentation), the Anthropic SDK (OpenInference, and OpenLLMetry), and the OpenAI
Agents SDK. The OpenAI SDK ones talk to Claude through Anthropic's OpenAI-compatible
endpoint, so one Anthropic key records them all. They live in their own uv project:
these instrumentation packages pin versions that clash with the main examples.

```sh
uv run --project compat python capture.py compat.anthropic_sdk_openinference
COMPAT_WRAP=1 uv run --project compat python capture.py compat.anthropic_sdk_openinference anthropic_sdk_openinference_wrapped
```

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
