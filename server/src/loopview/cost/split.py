"""Where a model call's tokens came from: an estimated split, scaled to the
reported truth.

The totals always come from the provider's reported usage. Only how they divide
into segments is estimated, from the content the trace recorded:

1. Estimate tokens per segment from the recorded content (characters per token).
2. Scale the estimates so they add up to the reported count. A simple estimate is
   off by up to about 20%, so a gap that size is estimation error and is scaled
   away. A bigger gap means content the trace doesn't have: the known segments are
   stretched by at most 1.25x and the rest is shown as "unattributed", never
   spread over segments it doesn't belong to.
3. Cache reads and writes are sub-counts of the input. Providers cache the start
   of the prompt (tools, then system, then messages), so those tokens are taken
   from the segments in that order.

Every function here is pure: a ModelCall and prices in, numbers out.
"""

import json
import math
from typing import Any, Literal

from loopview.cost.pricing import ModelPrice, Pricing
from loopview.normalize.schema import CallCost, CostSegment, CostSegmentName, MessagePart, ModelCall

# A segment counted from content may be stretched by at most this factor to
# reach the reported total. 1.25 = an estimate covering at least 80% of it.
MAX_STRETCH = 1.25

Segment = CostSegmentName
# Prompt order: the order providers cache a prefix in. "unattributed" input is
# placed last: we don't know where it sits, so cache tokens come from it last.
INPUT_ORDER: list[Segment] = [
    "tool_prompt",
    "tool_definitions",
    "system",
    "history",
    "tool_results",
    "new_input",
    "unattributed",
]


# --- 1. estimating tokens from content ------------------------------------------------


def estimate_tokens(value: Any) -> float:
    """Characters per token: about 4 for prose, about 3 for JSON and code, which
    split into more, shorter tokens. Proportions are what matter: the result is
    scaled to the reported count afterwards."""
    if value is None:
        return 0.0
    if isinstance(value, str):
        stripped = value.lstrip()
        return len(value) / (3 if stripped[:1] in ("{", "[") else 4)
    return len(json.dumps(value, ensure_ascii=False)) / 3


def _part_tokens(part: MessagePart) -> float:
    if part.type == "tool_call":
        return estimate_tokens(part.name or "") + estimate_tokens(
            part.arguments if part.arguments is not None else {}
        )
    if part.type == "tool_result":
        return estimate_tokens(part.result)
    return estimate_tokens(part.text or "")


def estimate_input(call: ModelCall) -> dict[Segment, float]:
    """Split the input by where it came from. "New input" is what follows the last
    assistant message (the latest user or handoff message); everything before it
    that isn't a tool result or the system prompt is history resent on this call."""
    estimates: dict[Segment, float] = {
        "tool_definitions": sum(estimate_tokens(d) for d in call.tool_definitions),
        "system": 0.0,
        "history": 0.0,
        "tool_results": 0.0,
        "new_input": 0.0,
    }
    last_assistant = max((i for i, m in enumerate(call.input) if m.role == "assistant"), default=-1)
    for index, message in enumerate(call.input):
        for part in message.parts:
            tokens = _part_tokens(part)
            if message.role == "system":
                estimates["system"] += tokens
            elif part.type == "tool_result":
                estimates["tool_results"] += tokens
            elif index > last_assistant:
                estimates["new_input"] += tokens
            else:
                estimates["history"] += tokens
    return estimates


def estimate_output(call: ModelCall) -> dict[Segment, float]:
    estimates: dict[Segment, float] = {"thinking": 0.0, "reply": 0.0}
    for message in call.output:
        for part in message.parts:
            estimates["thinking" if part.type == "reasoning" else "reply"] += _part_tokens(part)
    return estimates


def uses_tools(call: ModelCall) -> bool:
    """Tools were passed if they were recorded, or if the conversation calls them."""
    if call.tool_definitions:
        return True
    return any(
        p.type in ("tool_call", "tool_result") for m in [*call.input, *call.output] for p in m.parts
    )


# --- 2. scaling to the reported count ---------------------------------------------------


def scale_to(estimates: dict[Segment, float], reported: int) -> dict[Segment, int]:
    """Whole-token segments that add up to exactly `reported`, with any part the
    estimate can't account for under "unattributed" (see the module docstring)."""
    known = sum(estimates.values())
    if reported <= 0:
        return {name: 0 for name in estimates} | {"unattributed": 0}
    if known <= 0:
        return {name: 0 for name in estimates} | {"unattributed": reported}
    factor = min(reported / known, MAX_STRETCH)
    scaled = {name: math.floor(value * factor) for name, value in estimates.items()}
    gap = reported - sum(scaled.values())
    if factor < MAX_STRETCH or gap <= len(scaled):
        # Within the estimate's error: the remainder is rounding, give it to the
        # largest segment so the parts add up exactly.
        largest = max(scaled, key=lambda name: estimates[name])
        scaled[largest] += gap
        gap = 0
    return scaled | {"unattributed": gap}


def carve_cache(
    segments: dict[Segment, int], cache_read: int, cache_write: int
) -> dict[Segment, int]:
    """Move cached tokens out of the input segments, from the start of the prompt:
    cache reads first (the prefix already cached), then cache writes (the part
    being added to the cache). The input total doesn't change."""
    result = dict(segments)
    for name, amount in (("cache_read", cache_read), ("cache_write", cache_write)):
        taken = 0
        for segment in INPUT_ORDER:
            if taken >= amount:
                break
            take = min(result.get(segment, 0), amount - taken)
            result[segment] = result.get(segment, 0) - take
            taken += take
        result[name] = taken  # type: ignore[index]
    return result


# --- 3. the whole call ---------------------------------------------------------------


def call_cost(call: ModelCall, pricing: Pricing) -> CallCost:
    usage = call.usage
    match = pricing.for_model(call.model)
    key, price = match if match else (None, None)
    if usage is None or (usage.input_tokens is None and usage.output_tokens is None):
        return CallCost(
            status="no_usage", price_key=key, price_source=price.source if price else None
        )

    reported_in = usage.input_tokens or 0
    reported_out = usage.output_tokens or 0
    recorded = bool(call.input or call.output or call.tool_definitions)

    # Input. The provider's documented tool prompt is known exactly, so it is its
    # own segment rather than part of the estimate.
    tool_prompt = 0
    if (
        price
        and price.tool_prompt_tokens
        and uses_tools(call)
        and reported_in > price.tool_prompt_tokens
    ):
        tool_prompt = price.tool_prompt_tokens
    if recorded:
        inputs = scale_to(estimate_input(call), reported_in - tool_prompt)
    else:
        inputs = {"unattributed": reported_in - tool_prompt}
    inputs = {"tool_prompt": tool_prompt, **inputs}
    inputs = carve_cache(inputs, usage.cache_read_tokens or 0, usage.cache_write_tokens or 0)

    # Output. Reported thinking tokens are the truth for thinking; otherwise the
    # split comes from the text, like the input.
    if usage.reasoning_tokens is not None:
        reply_estimate = {"reply": estimate_output(call)["reply"]} if recorded else {}
        outputs = {
            "thinking": usage.reasoning_tokens,
            **scale_to(reply_estimate, reported_out - usage.reasoning_tokens),
        }
    elif recorded:
        outputs = scale_to(estimate_output(call), reported_out)
    else:
        outputs = {"unattributed": reported_out}

    segments = [
        _segment(name, "input", tokens, price) for name, tokens in inputs.items() if tokens > 0
    ]
    segments += [
        _segment(name, "output", tokens, price) for name, tokens in outputs.items() if tokens > 0
    ]
    return CallCost(
        status="estimated" if recorded else "content_not_recorded",
        segments=segments,
        tokens=reported_in + reported_out,
        dollars=round(sum(s.dollars or 0 for s in segments), 8) if price else None,
        price_key=key,
        price_source=price.source if price else None,
    )


def _segment(
    name: Any, side: Literal["input", "output"], tokens: int, price: ModelPrice | None
) -> CostSegment:
    if price is None:
        dollars = None
    elif name == "cache_read":
        dollars = tokens * price.cache_read / 1e6
    elif name == "cache_write":
        dollars = tokens * price.cache_write / 1e6
    else:
        dollars = tokens * (price.output if side == "output" else price.input) / 1e6
    return CostSegment(name=name, side=side, tokens=tokens, dollars=dollars)
