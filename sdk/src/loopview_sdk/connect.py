"""Send an agent's traces to loopview with one call, whatever it is built with.

    import loopview_sdk
    loopview_sdk.connect()

It does what every agent needs, so nothing else is required in most cases:
- an OTLP/HTTP exporter to loopview, sending every 100 ms, and LiveStartProcessor
  so steps light up when they start;
- the instrumentation of every agent framework or model SDK that is installed:
  each OpenTelemetry instrumentor package registers itself (the
  `opentelemetry_instrumentor` entry point), so they are found, not listed here.
  When two cover the same library (OpenInference's and OpenTelemetry's for the
  OpenAI SDK), OpenInference's is used: it records message content and tool
  definitions. Pydantic AI instruments itself and is turned on directly;
- message content capture, which some instrumentations leave off by default;
- a flush at exit, so a short script doesn't lose its last spans.

A hand-written loop on a model SDK has no span around it: each model call would be
a run of its own. Wrap the loop in `loopview_sdk.agent("name")` to make it one run.
"""

import atexit
import os
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from importlib.metadata import EntryPoint, entry_points
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from loopview_sdk._live import LiveStartProcessor

DEFAULT_URL = "http://127.0.0.1:4318"

# Instrumentors for agent frameworks and model SDKs, besides every OpenInference
# package: OpenTelemetry's own GenAI instrumentations and OpenLLMetry's register
# under these names. Other instrumentors (HTTP clients, databases) are left alone.
GENAI_NAMES = frozenset({
    "openai", "anthropic", "langchain", "llama_index", "bedrock", "vertexai",
    "google_genai", "mistralai", "groq", "cohere", "ollama", "crewai", "litellm",
    "openai_agents", "haystack", "dspy", "smolagents", "autogen", "agno", "mcp",
})

# Content capture, for instrumentations that leave it off by default. Only set
# when the variable isn't set already: a user's choice always wins.
CONTENT_DEFAULTS = {
    # OpenTelemetry's GenAI instrumentations (openai-v2, ...): content on spans,
    # where loopview reads it, rather than as log events.
    "OTEL_SEMCONV_STABILITY_OPT_IN": "gen_ai_latest_experimental",
    "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT": "SPAN_ONLY",
    # OpenLLMetry
    "TRACELOOP_TRACE_CONTENT": "true",
}


def connect(
    service_name: str | None = None,
    url: str | None = None,
    instrument: bool | Sequence[str] = True,
    capture_content: bool = True,
    live: bool = True,
    provider: TracerProvider | None = None,
    quiet: bool = False,
) -> TracerProvider:
    """Send this process's traces to loopview. Returns the TracerProvider used.

    service_name: shown under each run (default: the script's name).
    url:          loopview's address. Default: LOOPVIEW_URL, else the standard
                  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT if set, else http://127.0.0.1:4318.
    instrument:   True for every installed framework, False for none, or names
                  such as ["openai", "langchain"].
    provider:     a TracerProvider of your own to add loopview's processors to.
                  By default the global one is used if it is already an SDK
                  provider, otherwise one is created and made global.
    """
    standard = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").removesuffix("/v1/traces")
    base = (url or os.environ.get("LOOPVIEW_URL") or standard or DEFAULT_URL).rstrip("/")
    if capture_content:
        for key, value in CONTENT_DEFAULTS.items():
            os.environ.setdefault(key, value)

    provider, owned = _provider(provider, service_name)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{base}/v1/traces"), schedule_delay_millis=100)
    )
    if live:
        provider.add_span_processor(LiveStartProcessor(endpoint=f"{base}/v1/loopview/span-starts"))
    # Short scripts can end before the exporter's next batch: flush at exit.
    atexit.register(provider.shutdown if owned else provider.force_flush)

    instrumented = _instrument(provider, instrument) if instrument else []
    if not quiet:
        found = ", ".join(instrumented) or "nothing (no supported framework installed)"
        print(f"loopview: sending traces to {base}; instrumented {found}")
    return provider


@contextmanager
def agent(name: str, **attributes: Any) -> Iterator[trace.Span]:
    """A span around an agent's work, for loops that have none of their own.

        with loopview_sdk.agent("weather_assistant"):
            ...  # your loop: model calls, tool calls

    Everything inside becomes one run, drawn as this agent. Works in async code too.
    """
    tracer = trace.get_tracer("loopview_sdk")
    with tracer.start_as_current_span(
        f"invoke_agent {name}",
        attributes={"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": name, **attributes},
    ) as span:
        yield span


# --- helpers -------------------------------------------------------------------------------


def _provider(given: TracerProvider | None, service_name: str | None) -> tuple[TracerProvider, bool]:
    """The provider to use, and whether connect() created it."""
    if given is not None:
        return given, False
    current = trace.get_tracer_provider()
    if isinstance(current, TracerProvider):
        return current, False
    name = service_name or os.environ.get("OTEL_SERVICE_NAME") or _script_name()
    provider = TracerProvider(resource=Resource.create({"service.name": name}))
    trace.set_tracer_provider(provider)
    return provider, True


def _script_name() -> str:
    import __main__

    path = getattr(__main__, "__file__", None)
    return os.path.splitext(os.path.basename(path))[0] if path else "agent"


def choose_instrumentors(points: Sequence[EntryPoint], only: Sequence[str] | None = None) -> list[EntryPoint]:
    """One instrumentor per library, OpenInference's first; GenAI libraries only."""
    chosen: dict[str, EntryPoint] = {}
    for ep in points:
        dist = ep.dist.name if ep.dist else ""
        openinference = dist.startswith("openinference-instrumentation-")
        if not openinference and ep.name not in GENAI_NAMES:
            continue
        if only is not None and ep.name not in only:
            continue
        current = chosen.get(ep.name)
        current_is_oi = bool(current and current.dist and current.dist.name.startswith("openinference-"))
        if current is None or (openinference and not current_is_oi):
            chosen[ep.name] = ep
    return list(chosen.values())


def _instrument(provider: TracerProvider, which: bool | Sequence[str]) -> list[str]:
    only = None if which is True else list(which)  # type: ignore[arg-type]
    done: list[str] = []
    for ep in choose_instrumentors(list(entry_points(group="opentelemetry_instrumentor")), only):
        try:
            instrumentor = ep.load()()
            # The instrumentor's own check: is the library it instruments installed?
            if instrumentor._check_dependency_conflicts() is not None:
                continue
            if not getattr(instrumentor, "is_instrumented_by_opentelemetry", False):
                instrumentor.instrument(tracer_provider=provider)
            done.append(ep.name)
        except Exception:  # a broken instrumentor must never stop the agent
            continue
    if (only is None or "pydantic_ai" in only) and _instrument_pydantic_ai(provider):
        done.append("pydantic_ai")
    return done


def _instrument_pydantic_ai(provider: TracerProvider) -> bool:
    try:
        from pydantic_ai import Agent
        from pydantic_ai.models.instrumented import InstrumentationSettings
    except ImportError:
        return False
    Agent.instrument_all(InstrumentationSettings(tracer_provider=provider))
    return True
