"""@loopview_sdk.tool: one execute_tool span per call, with arguments, result, errors."""

import asyncio

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import loopview_sdk


@pytest.fixture
def spans() -> InMemorySpanExporter:
    # The tracer provider is global and can be set once per process.
    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        provider = TracerProvider()
        trace.set_tracer_provider(provider)
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return exporter


@loopview_sdk.tool
def get_weather(city: str, unit: str = "C") -> dict:
    if city == "Atlantis":
        raise ValueError("no weather station in 'Atlantis'")
    return {"city": city, "temp": 21, "unit": unit}


@loopview_sdk.tool(name="lookup")
async def search(query: str) -> list[str]:
    return [query.upper()]


def test_a_call_is_a_tool_span_with_arguments_and_result(spans: InMemorySpanExporter) -> None:
    assert get_weather("Lisbon") == {"city": "Lisbon", "temp": 21, "unit": "C"}
    [span] = spans.get_finished_spans()
    a = span.attributes or {}
    assert span.name == "execute_tool get_weather"
    assert a["gen_ai.operation.name"] == "execute_tool" and a["gen_ai.tool.name"] == "get_weather"
    assert a["gen_ai.tool.call.arguments"] == '{"city": "Lisbon"}'
    assert a["gen_ai.tool.call.result"] == '{"city": "Lisbon", "temp": 21, "unit": "C"}'


def test_an_exception_marks_the_call_failed_and_is_raised_again(spans: InMemorySpanExporter) -> None:
    with pytest.raises(ValueError, match="Atlantis"):
        get_weather("Atlantis")
    [span] = spans.get_finished_spans()
    assert span.status.status_code == trace.StatusCode.ERROR
    assert [e.name for e in span.events] == ["exception"]


def test_async_tools_and_a_custom_name(spans: InMemorySpanExporter) -> None:
    assert asyncio.run(search("x")) == ["X"]
    [span] = spans.get_finished_spans()
    assert span.name == "execute_tool lookup"
    assert (span.attributes or {})["gen_ai.tool.call.result"] == '["X"]'
    assert search.__name__ == "search"  # the function keeps its identity
