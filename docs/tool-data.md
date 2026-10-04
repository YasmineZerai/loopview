# What the traces contain, for the Tools tab

Inspected on 2026-10-04, against every fixture in `fixtures/` (all recorded with Claude Haiku 4.5).
None of the original fixtures had a failing tool for Pydantic AI or the Anthropic example, so two
were added: `failing_tool_anthropic` (no hotel price for Berlin) and `failing_tools_pydantic` (a
`ModelRetry` from a plain tool, and an MCP tool, on an in-process FastMCP server, that fails).

## Per framework

| | Anthropic SDK, hand instrumented (GenAI) | Pydantic AI (GenAI, built in) | LangGraph / LangChain (OpenInference) |
|---|---|---|---|
| Fixture with a failing tool | `failing_tool_anthropic` | `failing_tools_pydantic` | `flagship` (`fetch_repo_stats` times out) |
| Failed call marked? | Span status ERROR with the message, and `error.type`. No exception event. (This is the example's own code.) | Span status ERROR and an `exception` event (`ToolRetryError`). | Span status ERROR and an `exception` event, even with `handle_tool_errors=True`. |
| MCP `isError: true` | – | Pydantic AI turns it into `ModelRetry` (default `tool_error_behavior='retry'`), so it looks exactly like a local `ModelRetry`. The flag itself is not on the span. | – |
| Arguments | `gen_ai.tool.call.arguments` | `gen_ai.tool.call.arguments` | `input.value`; a tool with one argument records only the bare value (`"PostgreSQL"`) |
| Result | `gen_ai.tool.call.result`; none on failure | `gen_ai.tool.call.result`; on failure it holds the retry prompt sent to the model ("… Fix the errors and try again.") | `output.value`; none on failure |
| Tools offered to the model | `gen_ai.tool.definitions` on the chat span | `gen_ai.tool.definitions` (MCP tools included); also `model_request_parameters.function_tools` | `llm.tools.N.tool.json_schema` on the LLM span |
| Agent of a tool call | the parent `invoke_agent` span | the parent agent span; `gen_ai.agent.name` and `gen_ai.agent.call.id` are also on the tool span | the nearest agent ancestor (a subgraph, or the `LangGraph` root) |
| Run | the trace id | the trace id | the trace id |

All three tool-definition shapes have `name` at the top level, and all are already parsed into
`ModelCall.tool_definitions` by the normalizer.

## What this means for the report

- **Errors can be read from the status alone** in all three. Pydantic AI's retry prompt in the
  result of a failed call would make failed calls look like long results, so result sizes are
  averaged over successful calls only.
- **Parallel tool calls make "the next call" misleading.** In `flagship`, the three
  `fetch_repo_stats` calls are requested in one turn; the one right after the failure was asked
  for before the model saw the error. So the next move is read from the agent's next turn, once
  the error is back in front of the model (DECISIONS D44).
- **Timestamps tie.** On Windows a tool call, the call before it and the next model call can share
  one timestamp (D17). A tool call is matched to the model call that requested it by comparing
  its start with model calls' *ends*, which is right even when starts tie.
- **"No tools" and "tools not recorded" look the same** on a single model call. The tool list
  counts as recorded when at least one model call in the runs carries one.
