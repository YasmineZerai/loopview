"""The task and tools every compat agent shares, so recordings compare like for like.

Each compat script is set up the way loopview's README says: `loopview_sdk.connect()`,
the framework's usual OpenTelemetry instrumentation, and their own agent loop. Each
names its instrumentor explicitly (connect(instrument=False)), so every
instrumentation package is recorded, not only the one connect() would prefer.

COMPAT_WRAP=1 wraps a hand-written loop in `loopview_sdk.agent(...)`, the one line
the README asks for when a loop has no agent span. Without it the recording shows
what loopview gets before that line is added. The task needs two turns of tool calls, and one tool call fails on
purpose (there is no weather station in Atlantis), so graphs, costs and the Tools
tab all have something to show.

The OpenAI SDK scripts talk to Claude through Anthropic's OpenAI-compatible
endpoint, so one Anthropic key records them all.
"""

import json
import os
from contextlib import AbstractContextManager, nullcontext
from typing import Any
from pathlib import Path

from dotenv import load_dotenv

# The repo root .env holds ANTHROPIC_API_KEY and ANTHROPIC_MODEL; the environment wins.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

TASK = "What is the weather right now in Lisbon and in Atlantis? Give me both in Fahrenheit."
SYSTEM = "You are a weather assistant. Use the tools for every number."

WEATHER_C = {"lisbon": 21.0, "porto": 18.0, "madrid": 26.0}


def get_weather(city: str) -> dict[str, Any]:
    """Current temperature in Celsius for a city."""
    key = city.strip().lower()
    if key not in WEATHER_C:
        raise ValueError(f"no weather station in {city!r}")
    return {"city": key, "celsius": WEATHER_C[key]}


def to_fahrenheit(celsius: float) -> float:
    """Convert a temperature from Celsius to Fahrenheit."""
    return round(celsius * 9 / 5 + 32, 1)


TOOLS = {"get_weather": get_weather, "to_fahrenheit": to_fahrenheit}

PARAMETERS = {
    "get_weather": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
    },
    "to_fahrenheit": {
        "type": "object",
        "properties": {"celsius": {"type": "number"}},
        "required": ["celsius"],
    },
}
DESCRIPTIONS = {name: fn.__doc__ for name, fn in TOOLS.items()}


def run_tool(name: str, arguments: dict[str, Any]) -> tuple[str, bool]:
    """Run a tool; returns (result as text, failed)."""
    try:
        return json.dumps(TOOLS[name](**arguments)), False
    except Exception as exc:  # the model gets the error and can recover
        return f"error: {exc}", True


def agent_span() -> AbstractContextManager[Any]:
    """loopview_sdk.agent around the loop when COMPAT_WRAP=1, else nothing."""
    if os.environ.get("COMPAT_WRAP") == "1":
        import loopview_sdk

        return loopview_sdk.agent("weather_assistant")
    return nullcontext()


def model_name() -> str:
    name = os.environ.get("ANTHROPIC_MODEL")
    if not name:
        raise SystemExit("Set ANTHROPIC_MODEL (see .env.example).")
    return name


def openai_compatible_client() -> Any:
    """The OpenAI SDK, pointed at Claude (Anthropic's OpenAI-compatible endpoint)."""
    from openai import OpenAI

    return OpenAI(base_url="https://api.anthropic.com/v1/", api_key=os.environ["ANTHROPIC_API_KEY"])


def openai_tool_specs() -> list[dict[str, Any]]:
    return [
        {"type": "function", "function": {"name": n, "description": DESCRIPTIONS[n], "parameters": PARAMETERS[n]}}
        for n in TOOLS
    ]


def anthropic_tool_specs() -> list[dict[str, Any]]:
    return [{"name": n, "description": DESCRIPTIONS[n], "input_schema": PARAMETERS[n]} for n in TOOLS]


def openai_loop(client: Any) -> str:
    """A plain tool loop on the OpenAI chat completions API."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TASK}]
    for _ in range(8):
        reply = client.chat.completions.create(model=model_name(), messages=messages, tools=openai_tool_specs())
        message = reply.choices[0].message
        messages.append(message.model_dump(exclude_none=True))
        if not message.tool_calls:
            return message.content or ""
        for call in message.tool_calls:
            result, _ = run_tool(call.function.name, json.loads(call.function.arguments or "{}"))
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    return "(step limit)"


def anthropic_loop(client: Any) -> str:
    """A plain tool loop on the Anthropic messages API."""
    messages: list[dict[str, Any]] = [{"role": "user", "content": TASK}]
    for _ in range(8):
        reply = client.messages.create(
            model=model_name(), max_tokens=1024, system=SYSTEM, tools=anthropic_tool_specs(), messages=messages
        )
        messages.append({"role": "assistant", "content": reply.content})
        uses = [b for b in reply.content if b.type == "tool_use"]
        if not uses:
            return "".join(b.text for b in reply.content if b.type == "text")
        results = []
        for use in uses:
            result, failed = run_tool(use.name, use.input)
            results.append({"type": "tool_result", "tool_use_id": use.id, "content": result, "is_error": failed})
        messages.append({"role": "user", "content": results})
    return "(step limit)"
