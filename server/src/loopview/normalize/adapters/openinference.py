"""Adapter for OpenInference (Arize) semantic conventions.

Written against the spec in Arize-ai/openinference (spec/semantic_conventions.md)
as emitted by openinference-instrumentation-langchain 0.1.76 and
openinference-semantic-conventions 0.1.39. The spec itself has no version number.

A span is OpenInference if it has openinference.span.kind.

LangGraph: the LangChain instrumentor copies LangGraph's run metadata into the
`metadata` attribute. That is how we tell a real graph node (langgraph_node ==
span name) from plumbing inside a node, such as a routing function or an output
parser (langgraph_node != span name), which we keep but hide.
"""

import re
from typing import Any

from loopview.ingest.raw import RawSpan
from loopview.normalize.adapters.base import (
    Classification,
    ParentHint,
    as_int,
    maybe_json,
)
from loopview.normalize.schema import Message, MessagePart, ModelCall, ToolCall, Usage

TOOL_LIKE_KINDS = {
    "TOOL": "tool",
    "RETRIEVER": "retriever",
    "EMBEDDING": "embedding",
    "RERANKER": "reranker",
}


class OpenInferenceAdapter:
    name = "openinference"

    def matches(self, span: RawSpan) -> bool:
        return "openinference.span.kind" in span.attributes

    def classify(self, span: RawSpan) -> Classification:
        attrs = span.attributes
        kind = str(attrs["openinference.span.kind"]).upper()
        io = {
            "input": maybe_json(attrs.get("input.value")),
            "output": maybe_json(attrs.get("output.value")),
        }

        if kind == "LLM":
            model = attrs.get("llm.model_name") or span.name
            return Classification("model_call", str(model), "llm", model=_model_call(attrs))
        if kind in TOOL_LIKE_KINDS:
            name = attrs.get("tool.name") or span.name
            return Classification(
                "tool_call",
                str(name),
                TOOL_LIKE_KINDS[kind],
                tool=ToolCall(
                    name=str(name),
                    call_id=attrs.get("tool_call.id"),
                    arguments=io["input"],
                    result=_unwrap_tool_output(io["output"]),
                ),
            )
        if kind == "PROMPT":
            return Classification("node", span.name, "prompt", hidden=True, **io)
        if kind in ("GUARDRAIL", "EVALUATOR"):
            return Classification("node", span.name, kind.lower(), **io)

        # CHAIN and AGENT: graphs, graph nodes, chains, agents.
        metadata = _metadata(attrs)
        graph_node = metadata.get("langgraph_node")
        if graph_node is None and metadata.get("ls_integration") == "langgraph":
            return Classification("agent", span.name, "graph", **io)  # a compiled graph
        if graph_node is not None and graph_node != span.name:
            return Classification("node", span.name, "internal", hidden=True, **io)
        if graph_node == span.name:
            # A real node. If a subgraph runs inside it, the subgraph's own span has
            # the same name and sits directly under it: collapse the two.
            return Classification("node", span.name, "node", collapse_into_parent=True, **io)
        if kind == "AGENT":
            # graph.node.id is the agent's own name where the span name is a method
            # (CrewAI: "Weather assistant._execute_core").
            name = attrs.get("agent.name") or attrs.get("graph.node.id") or _readable(span.name)
            return Classification("agent", str(name), "agent", **io)
        # A chain directly inside a span of the same name is the same step recorded
        # twice (the OpenAI Agents SDK wraps its "Agent workflow" AGENT in a CHAIN).
        return Classification(
            "node", _readable(span.name), "chain", collapse_into_parent=True, **io
        )

    def infer_parent(self, span: RawSpan) -> ParentHint | None:
        metadata = _metadata(span.attributes)
        graph_node = metadata.get("langgraph_node")
        if graph_node is None:
            return None
        if graph_node != span.name:
            return ParentHint(str(graph_node), "node", "node")  # plumbing inside a node
        # A node inside a subgraph: the namespace is "outer:<id>|inner:<id>".
        namespace = str(metadata.get("langgraph_checkpoint_ns", "")).split("|")
        if len(namespace) > 1:
            return ParentHint(namespace[-2].split(":")[0], "agent", "graph")
        return None


_UUID_IN_NAME = re.compile(
    r"[_-]?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _readable(name: str) -> str:
    """A span name without the run's UUID in it (CrewAI: "Crew_<uuid>.kickoff")."""
    return _UUID_IN_NAME.sub("", name) or name


def _metadata(attrs: dict[str, Any]) -> dict[str, Any]:
    value = maybe_json(attrs.get("metadata"))
    return value if isinstance(value, dict) else {}


def _unwrap_tool_output(value: Any) -> Any:
    """LangChain serialises a tool result as a ToolMessage; show just its content."""
    if (
        isinstance(value, dict)
        and value.get("type") == "tool"
        and isinstance(value.get("data"), dict)
    ):
        return maybe_json(value["data"].get("content"))
    return value


def _model_call(attrs: dict[str, Any]) -> ModelCall:
    output = _messages(attrs, "llm.output_messages.")
    reasoning = _reasoning_from_raw_output(attrs.get("output.value"))
    if reasoning:
        if not output:
            output = [Message(role="assistant", parts=[])]
        output[0].parts[:0] = [MessagePart(type="reasoning", text=r) for r in reasoning]
    inputs = _messages(attrs, "llm.input_messages.")
    _add_raw_tool_results(inputs, attrs.get("input.value"))
    return ModelCall(
        provider=attrs.get("llm.provider") or attrs.get("llm.system"),
        model=attrs.get("llm.model_name"),
        input=inputs,
        output=output,
        tool_definitions=_tool_definitions(attrs),
        usage=_usage(attrs),
    )


def _tool_definitions(attrs: dict[str, Any]) -> list[Any]:
    """llm.tools.N.tool.json_schema, in order."""
    return [
        maybe_json(t.get("tool.json_schema"))
        for t in _group_by_index(attrs, "llm.tools.")
        if t.get("tool.json_schema") is not None
    ]


def _usage(attrs: dict[str, Any]) -> Usage | None:
    """Token counts from the spec's attributes, completed from the raw output.

    The instrumentor leaves out cache attributes that are zero, and doesn't copy
    reasoning (thinking) tokens into an attribute at all. Both are in the raw
    output it also records, as LangChain's usage_metadata."""
    raw = _raw_usage(attrs.get("output.value"))
    usage = Usage(
        input_tokens=as_int(attrs.get("llm.token_count.prompt")),
        output_tokens=as_int(attrs.get("llm.token_count.completion")),
        cache_read_tokens=_first(
            attrs.get("llm.token_count.prompt_details.cache_read"), raw.get("cache_read")
        ),
        cache_write_tokens=_first(
            attrs.get("llm.token_count.prompt_details.cache_write"), raw.get("cache_write")
        ),
        reasoning_tokens=_first(
            attrs.get("llm.token_count.completion_details.reasoning"), raw.get("reasoning")
        ),
    )
    return usage if usage.model_dump(exclude_none=True) else None


def _first(*values: Any) -> int | None:
    for value in values:
        if as_int(value) is not None:
            return as_int(value)
    return None


def _raw_usage(raw: Any) -> dict[str, int]:
    """Cache and reasoning counts from LangChain's usage_metadata in the raw output:
    {"input_token_details": {"cache_read", "cache_creation", "ephemeral_5m_input_tokens",
    "ephemeral_1h_input_tokens"}, "output_token_details": {"reasoning"}}.

    LangChain's cache_creation can read 0 while the per-lifetime counts
    (ephemeral_5m / ephemeral_1h) hold the cache writes, so the larger wins."""
    found: dict[str, int] = {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            meta = node.get("usage_metadata")
            if isinstance(meta, dict):
                inputs = meta.get("input_token_details") or {}
                outputs = meta.get("output_token_details") or {}
                if "cache_read" in inputs:
                    found["cache_read"] = as_int(inputs["cache_read"]) or 0
                writes = [
                    as_int(inputs.get(k))
                    for k in (
                        "cache_creation",
                        "ephemeral_5m_input_tokens",
                        "ephemeral_1h_input_tokens",
                    )
                ]
                if any(w is not None for w in writes):
                    found["cache_write"] = max(writes[0] or 0, (writes[1] or 0) + (writes[2] or 0))
                if "reasoning" in outputs:
                    found["reasoning"] = as_int(outputs["reasoning"]) or 0
                return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(maybe_json(raw))
    return found


def _reasoning_from_raw_output(raw: Any) -> list[str]:
    """Thinking text from the raw model output.

    The flattened llm.output_messages attributes drop thinking blocks, but the
    instrumentor also records the raw output (output.value), where the model's
    content blocks are kept, e.g. LangChain's {"type": "thinking", "thinking": ...}.
    We look for such blocks anywhere in it rather than depend on one exact layout.
    """
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            kind = node.get("type")
            if kind in ("thinking", "reasoning"):
                text = node.get("thinking") or node.get("reasoning") or node.get("text")
                if isinstance(text, str) and text.strip():
                    found.append(text)
                    return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(maybe_json(raw))
    # A generation can repeat the same message in several places; keep each once.
    return list(dict.fromkeys(found))


# --- flattened messages ------------------------------------------------------------
# OpenInference flattens lists into indexed keys, for example:
#   llm.input_messages.2.message.role = assistant
#   llm.input_messages.2.message.contents.0.message_content.text = ...
#   llm.input_messages.2.message.tool_calls.0.tool_call.function.name = weekday
#   llm.input_messages.3.message.tool_call_id = toolu_...

_INDEXED = re.compile(r"^(\d+)\.(.+)$")


def _group_by_index(flat: dict[str, Any], prefix: str) -> list[dict[str, Any]]:
    """{prefix}N.rest = v  ->  [ {rest: v}, ... ] ordered by N."""
    groups: dict[int, dict[str, Any]] = {}
    for key, value in flat.items():
        if not key.startswith(prefix):
            continue
        match = _INDEXED.match(key[len(prefix) :])
        if match:
            groups.setdefault(int(match.group(1)), {})[match.group(2)] = value
    return [groups[i] for i in sorted(groups)]


def _messages(attrs: dict[str, Any], prefix: str) -> list[Message]:
    messages = []
    for m in _group_by_index(attrs, prefix):
        parts: list[MessagePart] = []
        if m.get("message.content"):
            text = str(m["message.content"])
            # A tool result: role "tool" (OpenAI), or any message answering a tool
            # call (Anthropic sends results in a "user" message).
            if m.get("message.role") == "tool" or m.get("message.tool_call_id"):
                parts.append(
                    MessagePart(
                        type="tool_result",
                        id=m.get("message.tool_call_id"),
                        result=maybe_json(text),
                    )
                )
            else:
                parts.append(MessagePart(type="text", text=text))
        for c in _group_by_index(m, "message.contents."):
            kind = c.get("message_content.type", "text")
            if kind == "text":
                parts.append(MessagePart(type="text", text=str(c.get("message_content.text", ""))))
            elif kind == "tool_use":
                continue  # the same call is also under message.tool_calls
            else:
                parts.append(MessagePart(type="other", name=c.get("message_content.type")))
        for tc in _group_by_index(m, "message.tool_calls."):
            parts.append(
                MessagePart(
                    type="tool_call",
                    id=tc.get("tool_call.id"),
                    name=tc.get("tool_call.function.name"),
                    arguments=maybe_json(tc.get("tool_call.function.arguments")),
                )
            )
        messages.append(Message(role=str(m.get("message.role", "unknown")), parts=parts))
    return messages


def _add_raw_tool_results(inputs: list[Message], raw: Any) -> None:
    """Tool results from the raw request (input.value), which the flattened messages
    can lose: OpenInference's Anthropic instrumentation keeps only one tool result per
    message, and drops Anthropic's is_error flag. Results already present get the
    flag; missing ones are added to the message holding the other results."""
    found: dict[str, tuple[Any, bool | None]] = {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "tool_result" and node.get("tool_use_id"):
                flag = node.get("is_error")
                found[str(node["tool_use_id"])] = (
                    _tool_result_content(node.get("content")),
                    flag if isinstance(flag, bool) else None,
                )
                return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(maybe_json(raw))
    if not found:
        return
    present = {p.id: p for m in inputs for p in m.parts if p.type == "tool_result" and p.id}
    for call_id, (content, flag) in found.items():
        if call_id in present:
            present[call_id].is_error = flag
            continue
        # The message answering the previous calls, or a new one at the end.
        holder = next(
            (m for m in reversed(inputs) if any(p.type == "tool_result" for p in m.parts)), None
        )
        if holder is None:
            holder = Message(role="user", parts=[])
            inputs.append(holder)
        holder.parts.append(
            MessagePart(type="tool_result", id=call_id, result=content, is_error=flag)
        )


def _tool_result_content(content: Any) -> Any:
    """Anthropic's tool_result content: a string, or text blocks."""
    if isinstance(content, list):
        texts = [c.get("text") for c in content if isinstance(c, dict) and c.get("text")]
        content = "\n".join(texts) if texts else content
    return maybe_json(content)
