# loopview

**Debug your AI agents as a live graph, whatever framework they're built with.**

See which agent ran, what it thought, which tool failed, what it did next, and what it cost.
LangGraph, Pydantic AI, CrewAI, the OpenAI Agents SDK or your own loop: one view, from
standard OpenTelemetry, on your machine.

![loopview replaying a multi-agent run](https://raw.githubusercontent.com/YasmineZerai/loopview/main/docs/demo.gif)

[Live demo](https://yasminezerai.github.io/loopview/) ·
[Documentation](https://github.com/YasmineZerai/loopview#readme)

## Try it

```sh
uvx loopview demo
```

Your browser opens on a recorded multi-agent run. No API key needed.

## Watch your own agent

```sh
uvx loopview      # UI and OTLP endpoint on http://127.0.0.1:4318
```

In your agent's environment:

```sh
pip install loopview-sdk
```

```python
import loopview_sdk
loopview_sdk.connect()   # at the start of your program
```

`connect()` switches on the OpenTelemetry instrumentation of every agent framework and model
SDK it finds installed. Agents in other languages can send OTLP over HTTP to
`http://127.0.0.1:4318/v1/traces`.

Which instrumentation package each framework needs, and everything else, is in the
[README on GitHub](https://github.com/YasmineZerai/loopview#connect-your-agent).
