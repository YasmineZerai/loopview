"""CrewAI, connected to loopview the way the README says: loopview_sdk.connect() finds
and switches on the installed instrumentation (CrewAI's and the Anthropic SDK's).

Run (from examples/):  uv run --project compat_crewai python -m compat_crewai.weather_crew
"""

import loopview_sdk

loopview_sdk.connect()

from crewai import LLM, Agent, Crew, Task  # noqa: E402
from crewai.tools import tool  # noqa: E402

from compat import common  # noqa: E402


@tool("get_weather")
def get_weather(city: str) -> dict:
    """Current temperature in Celsius for a city."""
    return common.get_weather(city)


@tool("to_fahrenheit")
def to_fahrenheit(celsius: float) -> float:
    """Convert a temperature from Celsius to Fahrenheit."""
    return common.to_fahrenheit(celsius)


if __name__ == "__main__":
    forecaster = Agent(
        role="Weather assistant",
        goal="Report current temperatures accurately, using the tools for every number",
        backstory=common.SYSTEM,
        llm=LLM(model=f"anthropic/{common.model_name()}", max_tokens=1024),
        tools=[get_weather, to_fahrenheit],
        verbose=False,
    )
    task = Task(description=common.TASK, expected_output="Both temperatures in Fahrenheit", agent=forecaster)
    print(Crew(agents=[forecaster], tasks=[task], verbose=False).kickoff())
