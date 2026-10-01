"""Example 3: a multi-agent system on Pydantic AI, which emits OpenTelemetry GenAI
spans natively (Agent.instrument_all).

    invoke_workflow laptop_advice                 (our root span, GenAI convention)
      coordinator agent
        tool gather_facts  -> specs_researcher and reviews_researcher, in parallel
      writer agent  (programmatic hand-off: runs after the coordinator, with its notes)

Run:  uv run python multi_agent_pydantic.py
"""

import asyncio
import json

from opentelemetry import trace
from pydantic_ai import Agent
from pydantic_ai.models.instrumented import InstrumentationSettings

from shared import model_name, setup_tracing

QUESTION = (
    "A student needs a laptop for programming and light video editing, budget 1300 EUR. "
    "Compare the Aster Pro 14 and the Kestrel Air 15 and recommend one."
)

# Local, deterministic data (fictional products, so nothing looks like an ad).
SPECS = {
    "aster pro 14": {"cpu": "8 cores", "ram_gb": 16, "weight_kg": 1.4, "battery_h": 11},
    "kestrel air 15": {"cpu": "10 cores", "ram_gb": 32, "weight_kg": 1.8, "battery_h": 8},
}
PRICES_EUR = {"aster pro 14": 1190, "kestrel air 15": 1340}
REVIEWS = {
    "aster pro 14": {"score": 4.4, "praise": "keyboard, battery", "complaints": "only 16 GB RAM"},
    "kestrel air 15": {"score": 4.2, "praise": "fast, 32 GB RAM", "complaints": "heavy, loud fans"},
}


def _key(name: str) -> str:
    return name.strip().lower()


def build_agents(model: str) -> tuple[Agent, Agent]:
    specs_researcher = Agent(
        model, name="specs_researcher",
        instructions="Look up specs and price for each laptop. Reply with a short factual list.",
    )
    reviews_researcher = Agent(
        model, name="reviews_researcher",
        instructions="Look up reviews for each laptop. Reply with a short factual list.",
    )

    @specs_researcher.tool_plain
    def laptop_specs(name: str) -> dict:
        """Hardware specs for a laptop model."""
        return SPECS[_key(name)]

    @specs_researcher.tool_plain
    def laptop_price(name: str) -> int:
        """Current price in EUR for a laptop model."""
        return PRICES_EUR[_key(name)]

    @reviews_researcher.tool_plain
    def laptop_reviews(name: str) -> dict:
        """Aggregated review summary for a laptop model."""
        return REVIEWS[_key(name)]

    coordinator = Agent(
        model, name="coordinator",
        instructions=("Call gather_facts once with the two laptop names, then summarise the "
                      "facts as notes for a writer. Do not write the final recommendation."),
    )

    @coordinator.tool_plain
    async def gather_facts(laptops: list[str]) -> str:
        """Research the given laptops. Specs and reviews are gathered in parallel."""
        prompt = "Laptops: " + ", ".join(laptops)
        specs, reviews = await asyncio.gather(
            specs_researcher.run(prompt), reviews_researcher.run(prompt)
        )
        return json.dumps({"specs": specs.output, "reviews": reviews.output})

    writer = Agent(
        model, name="writer",
        instructions="Write a clear recommendation in under 120 words from the notes you get.",
    )
    return coordinator, writer


async def run() -> None:
    coordinator, writer = build_agents(f"anthropic:{model_name()}")
    tracer = trace.get_tracer("loopview.examples.multi_agent")
    with tracer.start_as_current_span(
        "invoke_workflow laptop_advice",
        attributes={"gen_ai.operation.name": "invoke_workflow",
                    "gen_ai.workflow.name": "laptop_advice"},
    ):
        notes = await coordinator.run(QUESTION)
        # Programmatic hand-off: the application passes control to the writer.
        answer = await writer.run(f"Question: {QUESTION}\n\nNotes:\n{notes.output}")
    print(answer.output)


def main() -> None:
    provider = setup_tracing("multi-agent-pydantic-example")
    Agent.instrument_all(InstrumentationSettings(tracer_provider=provider))
    asyncio.run(run())
    provider.shutdown()


if __name__ == "__main__":
    main()
