"""Send an agent's traces to loopview with one call, whatever it is built with.

    import loopview_sdk
    loopview_sdk.connect()

It does what every agent needs, so nothing else is required in most cases:
- an OTLP/HTTP exporter to loopview, sending every 100 ms, and LiveStartProcessor
  so steps light up when they start;
- the instrumentation of every agent framework or model SDK that is installed:
  each OpenTelemetry instrumentor package registers itself (the
  `opentelemetry_instrumentor` entry point), so they are found, not listed here.
  When several cover the same library (OpenInference's and OpenTelemetry's for
  the OpenAI SDK), OpenInference's is tried first: it records message content and
  tool definitions. If it doesn't support the installed version of the library,
  the next one is used, and a library none fits is reported. Pydantic AI
  instruments itself and is turned on directly;
- message content capture, which some instrumentations leave off by default;
- a flush at exit, so a short script doesn't lose its last spans.

A hand-written loop on a model SDK has no span around it: each model call would be
a run of its own. Wrap the loop in `loopview_sdk.agent("name")` to make it one run.
Its tool calls are rebuilt from the conversation by loopview; decorate the tools
with `@loopview_sdk.tool` for exact timing and errors (all of them, or none).
"""

import atexit
import functools
import inspect
import json
import os
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from importlib.metadata import EntryPoint, entry_points
from typing import Any, TypeVar, overload

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

    instrumented, skipped = _instrument(provider, instrument) if instrument else ([], [])
    if not quiet:
        found = ", ".join(instrumented) or "nothing (no supported framework installed)"
        print(f"loopview: sending traces to {base}; instrumented {found}")
        for item in skipped:
            print(f"loopview: could not instrument {item}")
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


F = TypeVar("F", bound=Callable[..., Any])


@overload
def tool(fn: F) -> F: ...
@overload
def tool(*, name: str | None = None) -> Callable[[F], F]: ...


def tool(fn: Callable[..., Any] | None = None, *, name: str | None = None) -> Any:
    """Record each call of a tool function: arguments, result, and errors.

        @loopview_sdk.tool
        def get_weather(city: str) -> dict: ...

    Works on async functions too. An exception marks the call as failed and is
    raised again unchanged. Optional: without it, loopview rebuilds tool calls
    from the conversation, with approximate timing and fewer errors.
    """

    def decorate(f: Callable[..., Any]) -> Callable[..., Any]:
        tool_name = name or f.__name__
        signature = inspect.signature(f)

        def start(args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
            try:
                bound = signature.bind(*args, **kwargs)
                arguments = _json(dict(bound.arguments))
            except TypeError:
                arguments = _json({"args": list(args), **kwargs})
            return trace.get_tracer("loopview_sdk").start_as_current_span(
                f"execute_tool {tool_name}",
                attributes={
                    "gen_ai.operation.name": "execute_tool",
                    "gen_ai.tool.name": tool_name,
                    "gen_ai.tool.type": "function",
                    "gen_ai.tool.call.arguments": arguments,
                },
                record_exception=True,
                set_status_on_exception=True,
            )

        if inspect.iscoroutinefunction(f):

            @functools.wraps(f)
            async def run_async(*args: Any, **kwargs: Any) -> Any:
                with start(args, kwargs) as span:
                    result = await f(*args, **kwargs)
                    span.set_attribute("gen_ai.tool.call.result", _json(result))
                    return result

            return run_async

        @functools.wraps(f)
        def run(*args: Any, **kwargs: Any) -> Any:
            with start(args, kwargs) as span:
                result = f(*args, **kwargs)
                span.set_attribute("gen_ai.tool.call.result", _json(result))
                return result

        return run

    return decorate(fn) if fn is not None else decorate


def _json(value: Any) -> str:
    try:
        return json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)


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


def rank_instrumentors(
    points: Sequence[EntryPoint], only: Sequence[str] | None = None
) -> dict[str, list[EntryPoint]]:
    """The instrumentors for each GenAI library, best first: OpenInference's (it
    records content and tool definitions), then the others in the order found."""
    ranked: dict[str, list[EntryPoint]] = {}
    for ep in points:
        if not _is_genai(ep) or (only is not None and ep.name not in only):
            continue
        ranked.setdefault(ep.name, []).append(ep)
    for candidates in ranked.values():
        candidates.sort(key=lambda ep: not _is_openinference(ep))  # stable
    return ranked


def _is_openinference(ep: EntryPoint) -> bool:
    return bool(ep.dist and ep.dist.name.startswith("openinference-instrumentation-"))


def _is_genai(ep: EntryPoint) -> bool:
    return _is_openinference(ep) or ep.name in GENAI_NAMES


def _instrument(provider: TracerProvider, which: bool | Sequence[str]) -> tuple[list[str], list[str]]:
    """Instrument every installed GenAI library. Returns (instrumented, skipped), the
    skipped ones with the reason: no instrumentor fits the installed version."""
    only = None if which is True else list(which)  # type: ignore[arg-type]
    done: list[str] = []
    skipped: list[str] = []
    ranked = rank_instrumentors(list(entry_points(group="opentelemetry_instrumentor")), only)
    for library, candidates in ranked.items():
        reasons = []
        for ep in candidates:
            try:
                instrumentor = ep.load()()
                # The instrumentor's own check: is a version it supports installed?
                conflict = instrumentor._check_dependency_conflicts()
                if conflict is not None:
                    if getattr(conflict, "found", None):  # installed, wrong version
                        reasons.append(f"{ep.dist.name if ep.dist else ep.name}: {conflict}")
                    continue
                if not getattr(instrumentor, "is_instrumented_by_opentelemetry", False):
                    instrumentor.instrument(tracer_provider=provider)
                done.append(library if _is_openinference(ep) else f"{library} ({ep.dist.name if ep.dist else ep.value})")
                break
            except Exception as exc:  # a broken instrumentor must never stop the agent
                reasons.append(f"{ep.dist.name if ep.dist else ep.name}: {exc}")
        else:
            if reasons:
                skipped.append(f"{library} ({'; '.join(reasons)})")
    if (only is None or "pydantic_ai" in only) and _instrument_pydantic_ai(provider):
        done.append("pydantic_ai")
    return done, skipped


def _instrument_pydantic_ai(provider: TracerProvider) -> bool:
    try:
        from pydantic_ai import Agent
        from pydantic_ai.models.instrumented import InstrumentationSettings
    except ImportError:
        return False
    Agent.instrument_all(InstrumentationSettings(tracer_provider=provider))
    return True
