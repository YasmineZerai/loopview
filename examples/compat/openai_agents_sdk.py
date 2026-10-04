"""The OpenAI Agents SDK on Claude (through LiteLLM), instrumented by OpenInference.

The SDK's own tracing uploads to OpenAI by default; that processor is removed so
only the OpenTelemetry spans are produced.

Run (from examples/):  uv run --project compat python -m compat.openai_agents_sdk
"""

import asyncio

from agents import Agent, Runner, function_tool, set_trace_processors
from agents.extensions.models.litellm_model import LitellmModel
from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor

import loopview_sdk
from compat import common


@function_tool
def get_weather(city: str) -> dict:
    """Current temperature in Celsius for a city."""
    return common.get_weather(city)


@function_tool
def to_fahrenheit(celsius: float) -> float:
    """Convert a temperature from Celsius to Fahrenheit."""
    return common.to_fahrenheit(celsius)


async def run() -> None:
    agent = Agent(
        name="weather_assistant",
        instructions=common.SYSTEM,
        model=LitellmModel(model=f"anthropic/{common.model_name()}"),
        tools=[get_weather, to_fahrenheit],
    )
    result = await Runner.run(agent, common.TASK)
    print(result.final_output)


if __name__ == "__main__":
    loopview_sdk.connect(instrument=False)
    set_trace_processors([])  # no upload to OpenAI's trace backend
    OpenAIAgentsInstrumentor().instrument()
    asyncio.run(run())
