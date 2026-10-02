"""Token usage extraction, per convention, against the real fixtures and edge cases.

What each fixture contains is documented in docs/cost-data.md."""

import json

from loopview.normalize.adapters.gen_ai import GenAiAdapter
from loopview.normalize.adapters.openinference import OpenInferenceAdapter
from loopview.normalize.schema import ModelCall
from tests.helpers import make_span
from tests.test_normalize_fixtures import normalized

T = "a" * 32


def model_calls(name: str) -> list[ModelCall]:
    n = normalized(name)
    return [s.model for s in n.steps if s.kind == "model_call" and not s.hidden and s.model]


# --- the real fixtures ------------------------------------------------------------------


def test_gen_ai_hand_instrumented_spec_names() -> None:
    calls = model_calls("react_anthropic")
    for call in calls:
        assert call.usage is not None
        assert call.usage.input_tokens and call.usage.output_tokens
        assert (call.usage.cache_read_tokens, call.usage.cache_write_tokens) == (0, 0)
        assert call.tool_definitions and call.tool_definitions[0]["name"] == "hotel_price"
    # The first call thinks before answering; its thinking tokens are reported.
    first = calls[0].usage
    assert (
        first is not None
        and first.reasoning_tokens
        and first.reasoning_tokens < first.output_tokens
    )  # type: ignore[operator]


def test_gen_ai_pydantic_ai_names() -> None:
    """Pydantic AI writes cache counts as gen_ai.usage.details.*, not the spec names."""
    calls = model_calls("multi_agent_pydantic")
    assert all(c.usage and c.usage.input_tokens and c.usage.output_tokens for c in calls)
    assert all(c.usage and c.usage.cache_read_tokens == 0 for c in calls)
    assert any(c.tool_definitions for c in calls)


def test_openinference_cache_from_attributes() -> None:
    """The flagship's analysts share a cached handbook: their first call writes the
    cache, later calls read it. Cache attributes appear only when non-zero."""
    calls = model_calls("flagship")
    writes = [c.usage.cache_write_tokens for c in calls if c.usage and c.usage.cache_write_tokens]
    reads = [c.usage.cache_read_tokens for c in calls if c.usage and c.usage.cache_read_tokens]
    assert len(writes) >= 3 and all(w > 4000 for w in writes)  # one per analyst
    assert reads and all(r > 4000 for r in reads)
    for c in calls:  # sub-counts never exceed the total
        assert c.usage is not None and c.usage.input_tokens is not None
        assert (c.usage.cache_read_tokens or 0) + (
            c.usage.cache_write_tokens or 0
        ) <= c.usage.input_tokens


def test_openinference_reasoning_and_zero_cache_from_raw_output() -> None:
    """The instrumentor doesn't put thinking tokens or zero cache counts in
    attributes; LangChain's usage_metadata in the raw output has them."""
    calls = model_calls("flagship")
    thinking = [c for c in calls if any(p.type == "reasoning" for m in c.output for p in m.parts)]
    assert thinking and all(c.usage and c.usage.reasoning_tokens for c in thinking)
    assert all(c.usage and c.usage.cache_read_tokens is not None for c in calls)


def test_openinference_tool_definitions() -> None:
    calls = model_calls("langgraph_router")
    with_tools = [c for c in calls if c.tool_definitions]
    assert with_tools
    assert {d["name"] for d in with_tools[0].tool_definitions} == {
        "days_between",
        "weekday",
        "is_leap_year",
    }


# --- edge cases ----------------------------------------------------------------------------


def test_spec_names_win_over_instrumentation_names() -> None:
    span = make_span(T, "1", gen_ai__operation__name="chat")
    span.attributes.update(
        {
            "gen_ai.usage.input_tokens": 100,
            "gen_ai.usage.cache_read.input_tokens": 40,
            "gen_ai.usage.details.cache_read_input_tokens": 999,
        }
    )
    usage = GenAiAdapter().classify(span).model.usage  # type: ignore[union-attr]
    assert usage is not None and usage.cache_read_tokens == 40


def test_no_usage_means_none_not_zero() -> None:
    span = make_span(T, "1", gen_ai__operation__name="chat")
    assert GenAiAdapter().classify(span).model.usage is None  # type: ignore[union-attr]
    span = make_span(T, "2", openinference__span__kind="LLM")
    assert OpenInferenceAdapter().classify(span).model.usage is None  # type: ignore[union-attr]


def test_langchain_cache_writes_from_lifetime_counts() -> None:
    """LangChain can report cache_creation as 0 while the 5-minute count holds the writes."""
    raw = {
        "usage_metadata": {
            "input_tokens": 5000,
            "input_token_details": {
                "cache_read": 0,
                "cache_creation": 0,
                "ephemeral_5m_input_tokens": 4300,
                "ephemeral_1h_input_tokens": 0,
            },
            "output_token_details": {"reasoning": 12},
        }
    }
    span = make_span(T, "1", openinference__span__kind="LLM", llm__token_count__prompt=5000)
    span.attributes["output.value"] = json.dumps(raw)
    usage = OpenInferenceAdapter().classify(span).model.usage  # type: ignore[union-attr]
    assert usage is not None
    assert (usage.cache_write_tokens, usage.cache_read_tokens, usage.reasoning_tokens) == (
        4300,
        0,
        12,
    )
