# What the traces contain, for the Cost tab

Inspected on 2026-10-02, against every fixture in `fixtures/` (all recorded with Claude Haiku 4.5).
Specs checked: OpenTelemetry GenAI conventions (`open-telemetry/semantic-conventions-genai`,
commit b31e9e8, 2026-09-30) and OpenInference (`spec/semantic_conventions.md`, main, and the
installed `openinference-semantic-conventions` 0.1.39).

## Per framework

| | LangGraph / LangChain (OpenInference) | Pydantic AI (GenAI) | Anthropic SDK, hand instrumented (GenAI) |
|---|---|---|---|
| Fixtures | `flagship`, `langgraph_router` | `multi_agent_pydantic` | `react_anthropic` |
| Input / output tokens | `llm.token_count.prompt`, `llm.token_count.completion` | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` |
| Cache read / write tokens | `llm.token_count.prompt_details.cache_read` / `cache_write`, **only when non-zero** (zero values are left out); also in the raw `output.value` | Pydantic AI's own names `gen_ai.usage.details.cache_read_input_tokens` / `cache_creation_input_tokens`, not the spec's `gen_ai.usage.cache_read.input_tokens` / `cache_write.input_tokens` | `gen_ai.usage.cache_read.input_tokens` / `cache_write.input_tokens` (spec names) |
| Reasoning (thinking) tokens | not as an attribute; in the raw `output.value` (`usage_metadata.output_token_details.reasoning`) | not shown by this example (it doesn't use thinking) | `gen_ai.usage.reasoning.output_tokens` |
| Message content | flattened `llm.input_messages.*`, `llm.output_messages.*` | `gen_ai.input.messages`, `gen_ai.output.messages`, on by default (`InstrumentationSettings(include_content=True)`) | `gen_ai.input.messages`, `gen_ai.output.messages` |
| System prompt | as a `system` message | `gen_ai.system_instructions` | `gen_ai.system_instructions` |
| Tool definitions | `llm.tools.N.tool.json_schema` | `gen_ai.tool.definitions` | `gen_ai.tool.definitions` |
| Tool results | `tool` messages in the input | `tool_call_response` parts | `tool_call_response` parts |
| Thinking text | only in the raw `output.value` (recovered, DECISIONS D32) | not used in this example | `reasoning` parts |

The flagship and the Anthropic example were re-captured for this table. The flagship's analysts
now share a long, cached handbook as their system prompt, so the fixture has real cache writes
(the first call of each analyst, about 4,300 tokens) and cache reads (their later calls).

## What this means for the split

- **Thinking tokens are reported** by the Anthropic API (`usage.output_tokens_details.thinking_tokens`,
  part of `output_tokens`). LangChain passes them on as `output_token_details.reasoning`; the
  OpenInference instrumentor doesn't copy them into an attribute, so we read the raw output.
  When no count is available, thinking versus reply is estimated from the text.
- **Input counts include cache tokens** in both specs ("SHOULD include all types of input tokens,
  including cached tokens" for GenAI; `prompt_details.*` "are already included" in
  `llm.token_count.prompt` for OpenInference). Anthropic's own `input_tokens` excludes them, so
  instrumentations add them back (LangChain does; our example now does).
- **Calls with tools carry content the trace never sees.** Anthropic adds a tool-use system
  prompt whenever tools are passed: 496 tokens for Claude Haiku 4.5 with `tool_choice` auto or
  none ([tool use pricing](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview#pricing)).
- **Caching needs a long enough prefix**: 4,096 tokens on Claude Haiku 4.5. In the flagship the
  synthesize and critic calls have no tools, so their prefix (the handbook alone, about 3,600
  tokens) stays below the minimum and isn't cached.

## How close a simple estimate gets

Characters divided by 4, compared with the reported input tokens, per model call (measured
before the re-capture):

| Calls | Estimate / reported |
|---|---|
| Without tools (prose only) | 0.74 to 1.01, mostly 0.86 to 1.01 |
| With tools, definitions recorded | 0.17 to 0.43 |
| With tools, definitions not recorded | 0.10 to 0.39 |

On the output side: 0.93 to 1.16 for prose and thinking; 0.16 to 0.67 for short replies that are
only tool calls (the tool call's JSON wrapper isn't in the recorded text).

The gap on calls with tools is mostly the provider's tool-use system prompt: for the first
flagship call, 772 tokens reported, about 175 recorded, and 496 of the difference is that prompt.
