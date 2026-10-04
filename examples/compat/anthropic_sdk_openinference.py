"""The Anthropic SDK, instrumented by OpenInference, in a plain tool loop.

Run (from examples/):  uv run --project compat python -m compat.anthropic_sdk_openinference
                       (COMPAT_WRAP=1 to wrap the loop in loopview_sdk.agent)
"""

import anthropic
from openinference.instrumentation.anthropic import AnthropicInstrumentor

import loopview_sdk
from compat.common import agent_span, anthropic_loop

if __name__ == "__main__":
    loopview_sdk.connect(instrument=False)
    AnthropicInstrumentor().instrument()
    with agent_span():
        print(anthropic_loop(anthropic.Anthropic()))
