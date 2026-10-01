# loopview-sdk

Optional companion to [loopview](https://github.com/YasmineZerai/loopview).

Standard OpenTelemetry exporters send a span only when it ends. loopview works
with that by inferring which steps are running, but a step with no finished
children stays invisible until it ends. This processor also reports every span
the moment it starts, so the graph lights up a step as soon as it begins.

```python
from loopview_sdk import LiveStartProcessor

provider.add_span_processor(LiveStartProcessor())  # next to your normal exporter
```

The endpoint defaults to `http://127.0.0.1:4318/v1/loopview/span-starts`; set
`LOOPVIEW_STARTS_ENDPOINT` to change it. Reports are sent from a background
thread every 50 ms and dropped silently if loopview isn't running.
