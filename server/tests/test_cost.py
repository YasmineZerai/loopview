"""The cost split: segmentation, scaling, the unattributed rule, cache carving,
pricing, and every fixture end to end."""

import json
from pathlib import Path

import pytest

from loopview.cost.pricing import ModelPrice, Pricing, default_pricing, merged_pricing
from loopview.cost.split import (
    MAX_STRETCH,
    call_cost,
    carve_cache,
    estimate_input,
    estimate_output,
    estimate_tokens,
    scale_to,
)
from loopview.normalize.schema import Message, MessagePart, ModelCall, Usage
from tests.test_usage import model_calls

PRICE = ModelPrice(
    input=1,
    output=5,
    cache_read=0.1,
    cache_write=1.25,
    tool_prompt_tokens=500,
    source="test",
    checked="2026-10-02",
)
PRICING = Pricing(models={"test-model": PRICE})


def text(role: str, value: str) -> Message:
    return Message(role=role, parts=[MessagePart(type="text", text=value)])


def conversation() -> ModelCall:
    """system, a user question, the model calling a tool, the tool's result, and a
    new user message after the last assistant turn."""
    return ModelCall(
        model="test-model",
        tool_definitions=[{"name": "lookup", "parameters": {"type": "object"}}],
        input=[
            text("system", "s" * 400),
            text("user", "q" * 800),
            Message(
                role="assistant",
                parts=[MessagePart(type="tool_call", name="lookup", arguments={"k": "v"})],
            ),
            Message(role="tool", parts=[MessagePart(type="tool_result", result="r" * 1200)]),
            text("user", "n" * 200),
        ],
        output=[
            Message(
                role="assistant",
                parts=[
                    MessagePart(type="reasoning", text="t" * 400),
                    MessagePart(type="text", text="a" * 400),
                ],
            )
        ],
    )


# --- estimating ------------------------------------------------------------------------


def test_estimate_tokens_prose_and_json() -> None:
    assert estimate_tokens("x" * 400) == 100  # about 4 characters per token
    assert estimate_tokens('{"a": 1}' * 30) == 80  # JSON: about 3
    assert estimate_tokens({"a": "b"}) == pytest.approx(len('{"a": "b"}') / 3)
    assert estimate_tokens(None) == 0


def test_segmentation_by_origin() -> None:
    est = estimate_input(conversation())
    assert est["system"] == 100
    assert est["history"] > 200  # the first question and the earlier tool call
    assert est["tool_results"] == 300
    assert est["new_input"] == 50  # only what follows the last assistant message
    assert est["tool_definitions"] > 0
    assert estimate_output(conversation()) == {"thinking": 100, "reply": 100}


# --- scaling and the unattributed rule ----------------------------------------------------


@pytest.mark.parametrize("reported", [50, 99, 100, 101, 120, 125, 126, 200, 1000])
def test_scaling_always_sums_to_the_reported_total(reported: int) -> None:
    scaled = scale_to({"system": 30.3, "history": 50.6, "new_input": 19.1}, reported)
    assert sum(scaled.values()) == reported
    assert all(v >= 0 for v in scaled.values())


def test_small_gaps_are_estimation_error_and_scaled_away() -> None:
    scaled = scale_to({"system": 40, "history": 60}, 120)  # estimate covers 83%
    assert scaled["unattributed"] == 0
    assert scaled == {"system": 48, "history": 72, "unattributed": 0}


def test_large_gaps_are_unattributed_not_stretched() -> None:
    scaled = scale_to({"system": 40, "history": 60}, 400)  # estimate covers 25%
    assert scaled["system"] == 40 * MAX_STRETCH and scaled["history"] == 60 * MAX_STRETCH
    assert scaled["unattributed"] == 400 - 100 * MAX_STRETCH


def test_overestimates_scale_down() -> None:
    assert scale_to({"system": 100, "history": 100}, 100) == {
        "system": 50,
        "history": 50,
        "unattributed": 0,
    }


def test_nothing_estimated_is_all_unattributed() -> None:
    assert scale_to({"system": 0}, 300) == {"system": 0, "unattributed": 300}


# --- cache --------------------------------------------------------------------------------


def test_cache_tokens_come_from_the_start_of_the_prompt() -> None:
    segments = {
        "tool_prompt": 100,
        "tool_definitions": 50,
        "system": 300,
        "history": 200,
        "tool_results": 0,
        "new_input": 50,
        "unattributed": 0,
    }
    carved = carve_cache(segments, cache_read=400, cache_write=100)  # type: ignore[arg-type]
    assert carved["cache_read"] == 400 and carved["cache_write"] == 100
    assert carved["tool_prompt"] == 0 and carved["tool_definitions"] == 0
    assert carved["system"] == 0  # 100 + 50 + 250 read, then 50 written
    assert carved["history"] == 150
    assert sum(carved.values()) == sum(segments.values())  # the input total is unchanged


# --- the whole call ------------------------------------------------------------------------


def test_call_cost_sums_to_reported_and_prices_each_segment() -> None:
    call = conversation()
    call.usage = Usage(
        input_tokens=1500, output_tokens=220, cache_read_tokens=600, cache_write_tokens=0
    )
    cost = call_cost(call, PRICING)
    by_name = {(s.name, s.side): s for s in cost.segments}
    assert cost.status == "estimated"
    assert sum(s.tokens for s in cost.segments) == cost.tokens == 1720
    assert ("tool_prompt", "input") not in by_name  # all of it was read from the cache
    assert by_name[("cache_read", "input")].dollars == pytest.approx(600 * 0.1 / 1e6)
    assert by_name[("reply", "output")].dollars == pytest.approx(
        by_name[("reply", "output")].tokens * 5 / 1e6
    )
    assert cost.dollars == pytest.approx(sum(s.dollars for s in cost.segments))  # type: ignore[misc]


def test_reported_thinking_tokens_are_used_as_is() -> None:
    call = conversation()
    call.usage = Usage(input_tokens=1500, output_tokens=300, reasoning_tokens=250)
    out = {s.name: s.tokens for s in call_cost(call, PRICING).segments if s.side == "output"}
    assert out["thinking"] == 250 and sum(out.values()) == 300


def test_tool_prompt_is_its_own_segment_only_when_tools_are_used() -> None:
    call = conversation()
    call.usage = Usage(input_tokens=1500, output_tokens=200)
    assert {s.name: s.tokens for s in call_cost(call, PRICING).segments}["tool_prompt"] == 500
    plain = ModelCall(
        model="test-model",
        input=[text("user", "hi " * 100)],
        usage=Usage(input_tokens=80, output_tokens=10),
    )
    assert "tool_prompt" not in {s.name for s in call_cost(plain, PRICING).segments}


def test_content_not_recorded_keeps_totals_and_known_counts() -> None:
    call = ModelCall(
        model="test-model",
        usage=Usage(
            input_tokens=1000, output_tokens=100, cache_read_tokens=300, reasoning_tokens=40
        ),
    )
    cost = call_cost(call, PRICING)
    tokens = {(s.name, s.side): s.tokens for s in cost.segments}
    assert cost.status == "content_not_recorded"
    assert tokens == {
        ("cache_read", "input"): 300,
        ("unattributed", "input"): 700,
        ("thinking", "output"): 40,
        ("unattributed", "output"): 60,
    }


def test_no_usage_invents_nothing() -> None:
    cost = call_cost(conversation(), PRICING)  # content, but no counts
    assert cost.status == "no_usage" and cost.segments == [] and cost.tokens is None


def test_unknown_model_has_tokens_but_no_dollars() -> None:
    call = conversation()
    call.model = "some-other-model"
    call.usage = Usage(input_tokens=1500, output_tokens=200)
    cost = call_cost(call, PRICING)
    assert cost.tokens == 1700 and cost.dollars is None and cost.price_key is None
    assert all(s.dollars is None for s in cost.segments)
    assert "tool_prompt" not in {s.name for s in cost.segments}  # its size is per model


# --- pricing --------------------------------------------------------------------------------


def test_dated_model_ids_match_their_family() -> None:
    pricing = default_pricing()
    assert pricing.for_model("claude-haiku-4-5-20251001")[0] == "claude-haiku-4-5"  # type: ignore[index]
    assert pricing.for_model("claude-sonnet-5-5")[0] == "claude-sonnet-5-5"  # type: ignore[index]
    assert pricing.for_model("claude-sonnet-5")[0] == "claude-sonnet-5"  # type: ignore[index]
    assert pricing.for_model("gpt-something") is None and pricing.for_model(None) is None


def test_openai_model_ids_match_the_right_entry() -> None:
    pricing = default_pricing()
    match = lambda model: pricing.for_model(model)[0]  # type: ignore[index]  # noqa: E731
    assert match("gpt-5.4-mini-2026-03-17") == "gpt-5.4-mini"  # dated ID, its family
    assert match("gpt-5.1") == "gpt-5.1"  # not gpt-5
    assert match("gpt-5-mini") == "gpt-5-mini"
    assert match("gpt-4o-2024-08-06") == "gpt-4o"
    assert match("gpt-4o-2024-05-13") == "gpt-4o-2024-05-13"  # the older, pricier snapshot
    assert match("o3-mini") == "o3-mini" and match("o3-2025-04-16") == "o3"
    assert match("gpt-3.5-turbo-1106") == "gpt-3.5-turbo-1106"


def test_openai_caching_is_priced_as_openai_bills_it() -> None:
    gpt = default_pricing().models["gpt-5.4"]
    assert gpt.cache_write == gpt.input  # writing the cache costs nothing extra
    assert gpt.cache_read == 0.25 and gpt.tool_prompt_tokens is None
    pro = default_pricing().models["gpt-5.4-pro"]
    assert pro.cache_read == pro.input  # no cached price: no invented discount


def test_every_bundled_price_has_a_source_and_date() -> None:
    for key, price in default_pricing().models.items():
        assert price.source.startswith("https://") and price.checked, key
        assert price.cache_read <= price.input < price.output, key  # equal: no cache discount


def test_user_prices_replace_bundled_ones(tmp_path: Path) -> None:
    file = tmp_path / "prices.json"
    file.write_text(
        json.dumps(
            {
                "models": {
                    "claude-haiku-4-5": {
                        "input": 9,
                        "output": 9,
                        "cache_read": 9,
                        "cache_write": 9,
                        "source": "mine",
                        "checked": "today",
                    }
                }
            }
        )
    )
    pricing = merged_pricing(file)
    assert pricing.for_model("claude-haiku-4-5")[1].input == 9  # type: ignore[index]
    assert pricing.for_model("claude-opus-5-5") is not None  # the rest stays


# --- every fixture ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name", ["flagship", "react_anthropic", "multi_agent_pydantic", "langgraph_router"]
)
def test_fixture_calls_add_up(name: str) -> None:
    for call in model_calls(name):
        assert call.cost is not None and call.usage is not None
        assert call.cost.status == "estimated"
        assert (
            sum(s.tokens for s in call.cost.segments)
            == call.usage.input_tokens + call.usage.output_tokens
        )  # type: ignore[operator]
        assert call.cost.dollars and call.cost.dollars > 0
        assert call.cost.price_key == "claude-haiku-4-5"


def test_flagship_shows_cache_reads_and_writes() -> None:
    names = {s.name for c in model_calls("flagship") for s in c.cost.segments}  # type: ignore[union-attr]
    assert {"cache_read", "cache_write", "thinking", "tool_prompt"} <= names
