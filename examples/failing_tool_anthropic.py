"""The hand-instrumented Anthropic agent (react_anthropic.py) with a task that makes
a tool fail: there is no hotel price for Berlin, so hotel_price raises and the span
is marked as an error.

Run:  uv run python failing_tool_anthropic.py
"""

import react_anthropic

react_anthropic.TASK = (
    "I'm planning 2 nights in Berlin and 2 nights in Madrid. Look up the average hotel "
    "price per night in each city, then tell me the total in EUR."
)

if __name__ == "__main__":
    react_anthropic.main()
