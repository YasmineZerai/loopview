"""Setup shared by every example: load .env, send traces to loopview.

This is the whole integration: a standard OpenTelemetry TracerProvider with the
standard OTLP/HTTP exporter. Nothing here is specific to loopview; the exporter
reads its endpoint from OTEL_EXPORTER_OTLP_TRACES_ENDPOINT.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# The repo root .env holds ANTHROPIC_API_KEY and friends. override=False keeps
# anything already set in the environment (the fixture capture script relies on it).
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)


def setup_tracing(service_name: str) -> TracerProvider:
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    # Optional (loopview-sdk): also report span starts, so steps show as running
    # the moment they begin. Turn off with LOOPVIEW_SDK=0 to see what plain
    # OpenTelemetry gives you.
    if os.environ.get("LOOPVIEW_SDK", "1") != "0":
        from loopview_sdk import LiveStartProcessor

        endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")
        starts = endpoint.replace("/v1/traces", "/v1/loopview/span-starts") or None
        provider.add_span_processor(LiveStartProcessor(endpoint=starts))
    trace.set_tracer_provider(provider)
    return provider


def model_name() -> str:
    """The Anthropic model, from ANTHROPIC_MODEL. Never hardcoded."""
    name = os.environ.get("ANTHROPIC_MODEL")
    if not name:
        raise SystemExit("Set ANTHROPIC_MODEL (see .env.example).")
    return name
