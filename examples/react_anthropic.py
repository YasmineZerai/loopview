"""Example 1: a hand-rolled ReAct agent on the Anthropic SDK, instrumented by hand
with the OpenTelemetry GenAI semantic conventions.

Spec: open-telemetry/semantic-conventions-genai, commit bcc7f9c (2026-09-29).
Span shapes used:
    invoke_agent {agent}     INTERNAL   the whole agent run
      chat {model}           CLIENT     one model call per loop iteration
      execute_tool {tool}    INTERNAL   one per tool the model asked for

Message content is opt-in in the spec; we record it on the spans
(gen_ai.input.messages / gen_ai.output.messages as JSON strings) because this is
a local development tool.

Run:  uv run python react_anthropic.py
"""

import json
from typing import Any

import anthropic
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode

from shared import model_name, setup_tracing

AGENT_NAME = "trip_budget_agent"
TASK = (
    "I'm planning 3 nights in Lisbon and 2 nights in Porto. Look up the average "
    "hotel price per night in each city, then tell me the total in EUR and in USD."
)

# Local, deterministic tools. The point is the control flow, not the data.
HOTEL_PRICES_EUR = {"lisbon": 142.0, "porto": 118.0, "madrid": 131.0}
EUR_TO = {"USD": 1.09, "GBP": 0.85}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "hotel_price",
        "description": "Average hotel price per night in EUR for a city.",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
    {
        "name": "calculator",
        "description": "Evaluate an arithmetic expression like '3 * 142 + 2 * 118'.",
        "input_schema": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
    {
        "name": "convert_currency",
        "description": "Convert an amount in EUR to another currency (USD or GBP).",
        "input_schema": {
            "type": "object",
            "properties": {"amount_eur": {"type": "number"}, "to": {"type": "string"}},
            "required": ["amount_eur", "to"],
        },
    },
]


def run_tool(name: str, args: dict[str, Any]) -> Any:
    if name == "hotel_price":
        city = args["city"].strip().lower()
        if city not in HOTEL_PRICES_EUR:
            raise ValueError(f"no price data for {args['city']!r}")
        return {"city": city, "eur_per_night": HOTEL_PRICES_EUR[city]}
    if name == "calculator":
        expression = args["expression"]
        if not set(expression) <= set("0123456789+-*/(). "):
            raise ValueError("only arithmetic is allowed")
        return {"result": eval(expression)}  # safe: characters checked above
    if name == "convert_currency":
        rate = EUR_TO[args["to"].upper()]
        return {"amount": round(args["amount_eur"] * rate, 2), "currency": args["to"].upper()}
    raise ValueError(f"unknown tool {name!r}")


# --- conversions between Anthropic content blocks and GenAI message parts ---------


def to_genai_parts(content: Any) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "content": content}]
    parts = []
    for block in content:
        block = block if isinstance(block, dict) else block.model_dump()
        if block["type"] == "text":
            parts.append({"type": "text", "content": block["text"]})
        elif block["type"] == "thinking":
            # GenAI conventions call this a reasoning part.
            parts.append({"type": "reasoning", "content": block["thinking"]})
        elif block["type"] == "tool_use":
            parts.append(
                {"type": "tool_call", "id": block["id"], "name": block["name"],
                 "arguments": block["input"]}
            )
        elif block["type"] == "tool_result":
            parts.append(
                {"type": "tool_call_response", "id": block["tool_use_id"],
                 "response": block["content"]}
            )
    return parts


def to_genai_messages(messages: list[dict[str, Any]]) -> str:
    return json.dumps([{"role": m["role"], "parts": to_genai_parts(m["content"])} for m in messages])


# --- the agent loop ----------------------------------------------------------------


def main() -> None:
    provider = setup_tracing("react-anthropic-example")
    tracer = trace.get_tracer("loopview.examples.react_anthropic")
    client = anthropic.Anthropic()
    model = model_name()
    system = "You are a careful travel budget assistant. Use the tools for every number."
    messages: list[dict[str, Any]] = [{"role": "user", "content": TASK}]

    with tracer.start_as_current_span(
        f"invoke_agent {AGENT_NAME}",
        kind=SpanKind.INTERNAL,
        attributes={
            "gen_ai.operation.name": "invoke_agent",
            "gen_ai.provider.name": "anthropic",
            "gen_ai.agent.name": AGENT_NAME,
            "gen_ai.request.model": model,
        },
    ) as agent_span:
        for _ in range(8):  # step limit, so a confused model can't loop forever
            with tracer.start_as_current_span(
                f"chat {model}",
                kind=SpanKind.CLIENT,
                attributes={
                    "gen_ai.operation.name": "chat",
                    "gen_ai.provider.name": "anthropic",
                    "gen_ai.request.model": model,
                    "gen_ai.system_instructions": json.dumps([{"type": "text", "content": system}]),
                    "gen_ai.input.messages": to_genai_messages(messages),
                },
            ) as chat_span:
                # Extended thinking, so the trace shows the model's reasoning. Claude
                # Haiku 4.5 takes a fixed budget (min 1024, below max_tokens). Thinking
                # blocks go back in the history unchanged with the rest of the reply.
                response = client.messages.create(
                    model=model, max_tokens=3000, system=system, tools=TOOLS, messages=messages,
                    thinking={"type": "enabled", "budget_tokens": 1024},
                )
                chat_span.set_attribute("gen_ai.response.model", response.model)
                chat_span.set_attribute("gen_ai.response.id", response.id)
                chat_span.set_attribute("gen_ai.response.finish_reasons", [response.stop_reason])
                chat_span.set_attribute("gen_ai.usage.input_tokens", response.usage.input_tokens)
                chat_span.set_attribute("gen_ai.usage.output_tokens", response.usage.output_tokens)
                chat_span.set_attribute(
                    "gen_ai.output.messages",
                    json.dumps([{
                        "role": "assistant",
                        "parts": to_genai_parts(response.content),
                        "finish_reason": response.stop_reason,
                    }]),
                )

            messages.append({"role": "assistant", "content": response.content})
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                final = "".join(b.text for b in response.content if b.type == "text")
                agent_span.set_attribute(
                    "gen_ai.output.messages",
                    json.dumps([{"role": "assistant", "parts": [{"type": "text", "content": final}]}]),
                )
                print(final)
                break

            results = []
            for tool_use in tool_uses:
                with tracer.start_as_current_span(
                    f"execute_tool {tool_use.name}",
                    kind=SpanKind.INTERNAL,
                    attributes={
                        "gen_ai.operation.name": "execute_tool",
                        "gen_ai.tool.name": tool_use.name,
                        "gen_ai.tool.call.id": tool_use.id,
                        "gen_ai.tool.type": "function",
                        "gen_ai.tool.call.arguments": json.dumps(tool_use.input),
                    },
                ) as tool_span:
                    try:
                        output = run_tool(tool_use.name, tool_use.input)
                        tool_span.set_attribute("gen_ai.tool.call.result", json.dumps(output))
                        results.append(
                            {"type": "tool_result", "tool_use_id": tool_use.id,
                             "content": json.dumps(output)}
                        )
                    except Exception as exc:
                        tool_span.set_status(Status(StatusCode.ERROR, str(exc)))
                        tool_span.set_attribute("error.type", type(exc).__name__)
                        results.append(
                            {"type": "tool_result", "tool_use_id": tool_use.id,
                             "content": f"error: {exc}", "is_error": True}
                        )
            messages.append({"role": "user", "content": results})

    provider.shutdown()  # flush remaining spans


if __name__ == "__main__":
    main()
