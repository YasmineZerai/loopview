"""Adapter for the OpenTelemetry GenAI semantic conventions.

Written against open-telemetry/semantic-conventions-genai at commit bcc7f9c
(2026-09-29), status Development. Also reads the older shape that existing
instrumentations still emit: messages as span events (gen_ai.user.message,
gen_ai.choice, ...) and gen_ai.system instead of gen_ai.provider.name.

A span is GenAI if it has gen_ai.operation.name.
"""

from typing import Any

from loopview.ingest.raw import RawSpan
from loopview.normalize.adapters.base import (
    Classification,
    ParentHint,
    as_int,
    maybe_json,
)
from loopview.normalize.schema import Message, MessagePart, ModelCall, ToolCall

MODEL_OPERATIONS = {"chat", "text_completion", "generate_content", "embeddings"}
TOOL_LIKE_OPERATIONS = {
    "execute_tool",
    "retrieval",
    "create_memory",
    "search_memory",
    "update_memory",
    "upsert_memory",
    "delete_memory",
    "create_memory_store",
    "delete_memory_store",
}
# The event that carries messages when content is recorded on events.
DETAILS_EVENT = "gen_ai.client.inference.operation.details"
# Older, deprecated per-message events.
LEGACY_MESSAGE_EVENTS = {
    "gen_ai.system.message": "system",
    "gen_ai.user.message": "user",
    "gen_ai.assistant.message": "assistant",
    "gen_ai.tool.message": "tool",
}


class GenAiAdapter:
    name = "gen_ai"

    def matches(self, span: RawSpan) -> bool:
        return "gen_ai.operation.name" in span.attributes

    def classify(self, span: RawSpan) -> Classification:
        attrs = span.attributes
        operation = str(attrs["gen_ai.operation.name"])

        if operation == "invoke_agent":
            name = attrs.get("gen_ai.agent.name") or _name_after_operation(span.name, operation)
            return Classification("agent", str(name), "agent", output=_final_output(attrs))
        if operation == "invoke_workflow":
            name = attrs.get("gen_ai.workflow.name") or _name_after_operation(span.name, operation)
            return Classification("agent", str(name), "workflow")
        if operation in MODEL_OPERATIONS:
            model = attrs.get("gen_ai.request.model") or attrs.get("gen_ai.response.model")
            return Classification(
                "model_call", str(model or span.name), "llm", model=_model_call(span)
            )
        if operation in TOOL_LIKE_OPERATIONS:
            tool_name = attrs.get("gen_ai.tool.name") or _name_after_operation(span.name, operation)
            label = "tool" if operation == "execute_tool" else operation
            return Classification(
                "tool_call",
                str(tool_name),
                label,
                tool=ToolCall(
                    name=str(tool_name),
                    call_id=attrs.get("gen_ai.tool.call.id"),
                    arguments=maybe_json(attrs.get("gen_ai.tool.call.arguments")),
                    result=maybe_json(attrs.get("gen_ai.tool.call.result")),
                ),
            )
        # plan, create_agent, or an operation this version doesn't know yet.
        name = attrs.get("gen_ai.agent.name") or span.name
        return Classification("node", str(name), operation)

    def infer_parent(self, span: RawSpan) -> ParentHint | None:
        # Model and tool calls made inside an agent carry the agent's name.
        operation = span.attributes.get("gen_ai.operation.name")
        agent = span.attributes.get("gen_ai.agent.name")
        if agent and operation != "invoke_agent":
            return ParentHint(str(agent), "agent", "agent")
        return None


def _name_after_operation(span_name: str, operation: str) -> str:
    """Span names look like '{operation} {name}'; take the name part."""
    prefix = operation + " "
    return span_name[len(prefix) :] if span_name.startswith(prefix) else span_name


def _final_output(attrs: dict[str, Any]) -> Any:
    messages = _messages(attrs.get("gen_ai.output.messages"))
    return _text_of(messages) if messages else None


def _model_call(span: RawSpan) -> ModelCall:
    attrs = dict(span.attributes)
    # Content can live on the inference details event instead of the span.
    for event in span.events:
        if event.name == DETAILS_EVENT:
            for key in (
                "gen_ai.input.messages",
                "gen_ai.output.messages",
                "gen_ai.system_instructions",
            ):
                attrs.setdefault(key, event.attributes.get(key))

    inputs = _messages(attrs.get("gen_ai.input.messages"))
    outputs = _messages(attrs.get("gen_ai.output.messages"))
    system = _parts(maybe_json(attrs.get("gen_ai.system_instructions")))
    if system:
        inputs = [Message(role="system", parts=system), *inputs]
    if not inputs and not outputs:
        inputs, outputs = _legacy_event_messages(span)

    return ModelCall(
        provider=attrs.get("gen_ai.provider.name") or attrs.get("gen_ai.system"),
        model=attrs.get("gen_ai.response.model") or attrs.get("gen_ai.request.model"),
        input=inputs,
        output=outputs,
        input_tokens=as_int(attrs.get("gen_ai.usage.input_tokens")),
        output_tokens=as_int(attrs.get("gen_ai.usage.output_tokens")),
    )


def _messages(value: Any) -> list[Message]:
    value = maybe_json(value)
    if not isinstance(value, list):
        return []
    return [
        Message(role=str(m.get("role", "unknown")), parts=_parts(m.get("parts")))
        for m in value
        if isinstance(m, dict)
    ]


def _parts(value: Any) -> list[MessagePart]:
    if isinstance(value, str):
        return [MessagePart(type="text", text=value)]
    if not isinstance(value, list):
        return []
    parts = []
    for p in value:
        if not isinstance(p, dict):
            continue
        kind = p.get("type")
        if kind == "text":
            parts.append(MessagePart(type="text", text=str(p.get("content", ""))))
        elif kind == "tool_call":
            parts.append(
                MessagePart(
                    type="tool_call",
                    id=p.get("id"),
                    name=p.get("name"),
                    arguments=maybe_json(p.get("arguments")),
                )
            )
        elif kind == "reasoning":
            parts.append(MessagePart(type="reasoning", text=str(p.get("content", ""))))
        elif kind == "tool_call_response":
            parts.append(
                MessagePart(
                    type="tool_result",
                    id=p.get("id"),
                    result=maybe_json(p.get("response", p.get("result"))),
                )
            )
        else:
            # reasoning, blob, uri, file and future part types: keep them readable.
            content = p.get("content")
            parts.append(
                MessagePart(type="other", name=kind, text=None if content is None else str(content))
            )
    return parts


def _legacy_event_messages(span: RawSpan) -> tuple[list[Message], list[Message]]:
    inputs, outputs = [], []
    for event in span.events:
        a = event.attributes
        if event.name in LEGACY_MESSAGE_EVENTS:
            content = maybe_json(a.get("content"))
            inputs.append(
                Message(
                    role=LEGACY_MESSAGE_EVENTS[event.name],
                    parts=[MessagePart(type="text", text=_as_text(content))],
                )
            )
        elif event.name == "gen_ai.choice":
            message = maybe_json(a.get("message"))
            content = message.get("content") if isinstance(message, dict) else message
            outputs.append(
                Message(role="assistant", parts=[MessagePart(type="text", text=_as_text(content))])
            )
    return inputs, outputs


def _as_text(value: Any) -> str:
    return value if isinstance(value, str) else ("" if value is None else str(value))


def _text_of(messages: list[Message]) -> str:
    return "\n".join(p.text for m in messages for p in m.parts if p.type == "text" and p.text)
