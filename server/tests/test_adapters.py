"""Adapter behaviour that the fixtures don't cover: older GenAI shapes, other
OpenInference kinds, and unknown spans."""

import json

from loopview.normalize.adapters import adapter_for
from loopview.normalize.adapters.gen_ai import GenAiAdapter
from loopview.normalize.adapters.openinference import OpenInferenceAdapter
from loopview.normalize.normalizer import normalize_run
from loopview.store.memory import TraceStore
from tests.helpers import make_span

T = "a" * 32


def test_adapter_selection() -> None:
    assert adapter_for(make_span(T, "1", openinference__span__kind="LLM")).name == "openinference"
    assert adapter_for(make_span(T, "1", gen_ai__operation__name="chat")).name == "gen_ai"
    assert adapter_for(make_span(T, "1", http__method="GET")).name == "generic"


def test_gen_ai_structured_attributes_and_system_instructions() -> None:
    span = make_span(T, "1", name="chat m")
    span.attributes = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "openai",
        "gen_ai.request.model": "m",
        "gen_ai.system_instructions": [{"type": "text", "content": "be brief"}],
        "gen_ai.input.messages": [{"role": "user", "parts": [{"type": "text", "content": "hi"}]}],
        "gen_ai.output.messages": json.dumps(
            [
                {
                    "role": "assistant",
                    "parts": [
                        {"type": "reasoning", "content": "thinking"},
                        {
                            "type": "tool_call",
                            "id": "c1",
                            "name": "search",
                            "arguments": {"q": "x"},
                        },
                    ],
                }
            ]
        ),
    }
    model = GenAiAdapter().classify(span).model
    assert model is not None
    assert [m.role for m in model.input] == ["system", "user"]
    reasoning, call = model.output[0].parts
    assert (reasoning.type, reasoning.text) == ("reasoning", "thinking")
    assert call.type == "tool_call" and call.arguments == {"q": "x"}


def test_gen_ai_legacy_message_events() -> None:
    from loopview.ingest.raw import SpanEvent

    span = make_span(T, "1", gen_ai__operation__name="chat", gen_ai__system="openai")
    span.events = [
        SpanEvent(name="gen_ai.user.message", time_unix_nano=1, attributes={"content": "hi"}),
        SpanEvent(
            name="gen_ai.choice",
            time_unix_nano=2,
            attributes={"message": json.dumps({"content": "hello"})},
        ),
    ]
    model = GenAiAdapter().classify(span).model
    assert model is not None and model.provider == "openai"
    assert model.input[0].parts[0].text == "hi"
    assert model.output[0].parts[0].text == "hello"


def test_gen_ai_unknown_operation_is_a_node() -> None:
    c = GenAiAdapter().classify(make_span(T, "1", name="plan x", gen_ai__operation__name="plan"))
    assert (c.kind, c.type_label) == ("node", "plan")


def test_openinference_other_kinds() -> None:
    oi = OpenInferenceAdapter()
    retriever = oi.classify(make_span(T, "1", name="search", openinference__span__kind="RETRIEVER"))
    assert (retriever.kind, retriever.type_label) == ("tool_call", "retriever")
    agent = oi.classify(
        make_span(T, "1", name="a", openinference__span__kind="AGENT", agent__name="planner")
    )
    assert (agent.kind, agent.name) == ("agent", "planner")
    chain = oi.classify(
        make_span(T, "1", name="RunnableSequence", openinference__span__kind="CHAIN")
    )
    assert (chain.kind, chain.hidden) == ("node", False)  # plain LangChain: shown


def test_unknown_spans_are_kept_and_shown_unless_inside_a_call() -> None:
    store = TraceStore()
    store.add_spans(
        [
            make_span(T, "01", name="request handler", start=0, end=100, http__route="/ask"),
            make_span(
                T,
                "02",
                parent_span_id="01",
                name="chat m",
                start=10,
                end=50,
                gen_ai__operation__name="chat",
            ),
            make_span(
                T, "03", parent_span_id="02", name="POST", start=11, end=49, http__method="POST"
            ),
        ]
    )
    n = normalize_run(store.get_run(T), now_ns=0)  # type: ignore[arg-type]
    by_name = {s.name: s for s in n.steps}
    handler = by_name["request handler"]
    assert handler.kind == "unknown" and not handler.hidden
    assert handler.attributes == {"http.route": "/ask"}
    assert by_name["POST"].hidden  # an HTTP call made by the model call
    assert len(n.steps) == 3
