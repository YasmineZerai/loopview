"""Tools that fail on purpose, on Pydantic AI, to see how failures are traced.

Two kinds of failure:
- a plain tool that raises ModelRetry (Pydantic AI's "tell the model to try again"),
- a tool on an MCP server that fails, which reaches the client as `isError: true`.

The MCP server runs in-process (FastMCP), so no API key or network is needed for it.
The task is worded so the model hits both errors and has to recover.

Run:  uv run python failing_tools_pydantic.py
"""

import asyncio

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models.instrumented import InstrumentationSettings

from shared import model_name, setup_tracing

TASK = "What is the status of order 1234, and how many units of SKU-0099 (the blue mug) are in stock?"

ORDERS = {"ORD-1234": "shipped on 2026-09-30"}
SKUS = {"blue mug": "SKU-0042", "red mug": "SKU-0043"}
STOCK = {"SKU-0042": 17, "SKU-0043": 0}

inventory = FastMCP("inventory")


@inventory.tool
def get_stock(sku: str) -> int:
    """Units in stock for a SKU (like SKU-0042)."""
    if sku not in STOCK:
        # FastMCP turns this into a tool result with isError: true.
        raise ToolError(f"unknown sku {sku!r}; look it up with find_sku first")
    return STOCK[sku]


@inventory.tool
def find_sku(product_name: str) -> str:
    """The SKU for a product name."""
    sku = SKUS.get(product_name.strip().lower().replace("-", " "))
    if sku is None:
        raise ToolError(f"no product named {product_name!r}")
    return sku


async def run() -> None:
    agent = Agent(
        f"anthropic:{model_name()}",
        name="shop_assistant",
        instructions="Answer with the tools. If a tool fails, read the error and try again.",
        toolsets=[MCPToolset(inventory)],
    )

    @agent.tool_plain
    def order_status(order_id: str) -> str:
        """Status of an order."""
        if order_id not in ORDERS:
            raise ModelRetry(f"order id {order_id!r} not found; ids look like ORD-1234")
        return ORDERS[order_id]

    result = await agent.run(TASK)
    print(result.output)


def main() -> None:
    provider = setup_tracing("failing-tools-pydantic-example")
    Agent.instrument_all(InstrumentationSettings(tracer_provider=provider))
    asyncio.run(run())
    provider.shutdown()


if __name__ == "__main__":
    main()
