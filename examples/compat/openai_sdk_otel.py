"""The OpenAI SDK, instrumented by OpenTelemetry's own GenAI instrumentation
(opentelemetry-instrumentation-openai-v2), in a plain tool loop. connect() turns on
its message content capture, on spans.

Run (from examples/):  uv run --project compat python -m compat.openai_sdk_otel
                       (COMPAT_WRAP=1 to wrap the loop in loopview_sdk.agent)
"""

from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor

import loopview_sdk
from compat.common import agent_span, openai_compatible_client, openai_loop

if __name__ == "__main__":
    loopview_sdk.connect(instrument=False)
    OpenAIInstrumentor().instrument()
    with agent_span():
        print(openai_loop(openai_compatible_client()))
