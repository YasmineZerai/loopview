# loopview-sdk

Connect any Python agent to [loopview](https://github.com/YasmineZerai/loopview) in one call.

```python
import loopview_sdk
loopview_sdk.connect()
```

`connect()` does what every agent needs:

- sends traces to loopview (`LOOPVIEW_URL`, else `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
  else `http://127.0.0.1:4318`), every 100 ms;
- switches on the OpenTelemetry instrumentation of every installed agent framework or
  model SDK. Instrumentor packages register themselves, so any OpenInference package,
  OpenTelemetry's GenAI instrumentations and OpenLLMetry are found; when two cover the
  same library, OpenInference's is used. Pydantic AI is switched on directly;
- turns on message content capture where an instrumentation leaves it off;
- reports span starts, so steps light up the moment they begin;
- flushes at exit, so short scripts don't lose their last spans.

Options: `connect(service_name=..., url=..., instrument=["openai"] or False,
capture_content=False, live=False, provider=my_provider, quiet=True)`.

## A loop you wrote yourself

Model SDK instrumentation records model calls only. Wrap your loop so it is one run,
drawn as an agent:

```python
with loopview_sdk.agent("weather_assistant"):
    ...  # your loop
```

## Only the live start reports

`LiveStartProcessor` is the start reporter `connect()` adds, usable on its own next to
your own exporter:

```python
from loopview_sdk import LiveStartProcessor
provider.add_span_processor(LiveStartProcessor())
```
