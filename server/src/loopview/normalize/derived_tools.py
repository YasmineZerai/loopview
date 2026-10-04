"""Tool calls rebuilt from the conversation, when no span records them.

Instrumenting a model SDK (OpenAI, Anthropic, through OpenInference, OpenLLMetry or
OpenTelemetry's own packages) records model calls only: the tools are the user's
own functions, and nothing traces them. The conversation still says what happened.
A model call's output asks for tools (`tool_call` parts: id, name, arguments), and
the next model call's input carries their results (`tool_result` parts, same id).

So when a run has no tool call spans at all, each requested tool becomes a tool
call step, marked `synthetic`:
- name and arguments: from the request;
- result: from the next model call in the same scope that answers it;
- start: when the requesting call ended; end: when the answering call started (the
  tool ran somewhere in between; the exact time isn't known). With no answer in
  the run, it lasts no time and has no result;
- failed: only when the result is flagged as an error (Anthropic's `is_error`).
  The OpenAI API has no such flag, and errors are never guessed from text
  (DECISIONS D44), so there it stays "ok".

Runs with any tool call span are left alone: their tools are recorded for real
(by a framework, or loopview_sdk.tool). A request with no span there is deliberate,
not lost: structured output, for instance, is a tool call that is never run (the
flagship's `Plan`). So decorate all of a loop's tools with loopview_sdk.tool, or none.
"""

from loopview.normalize.schema import MessagePart, Step, ToolCall


def derive_tool_calls(steps: list[Step]) -> list[Step]:
    if any(s.kind == "tool_call" and not s.synthetic for s in steps):
        return steps
    by_scope: dict[str | None, list[Step]] = {}
    for s in steps:
        if s.kind == "model_call" and not s.hidden and s.model is not None:
            by_scope.setdefault(s.scope_id, []).append(s)

    derived: list[Step] = []
    for calls in by_scope.values():
        calls.sort(key=lambda s: (s.start_ns, s.id))
        for i, call in enumerate(calls):
            requests = [p for m in call.model.output for p in m.parts if p.type == "tool_call"]  # type: ignore[union-attr]
            if not requests or call.end_ns is None:
                continue
            later = calls[i + 1 :]
            for n, request in enumerate(requests):
                answer, result = _answer(request, later)
                end = answer.start_ns if answer is not None else call.end_ns
                derived.append(
                    Step(
                        id=f"{call.id}~tool{n}",
                        run_id=call.run_id,
                        parent_id=call.scope_id,
                        scope_id=call.scope_id,
                        kind="tool_call",
                        type_label="tool",
                        name=request.name or "tool",
                        key="",  # set when keys are built (loop_nodes._rekey)
                        status="error" if result is not None and result.is_error else "ok",
                        start_ns=call.end_ns,
                        end_ns=max(end, call.end_ns),
                        error=_error_text(result),
                        tool=ToolCall(
                            name=request.name or "tool",
                            call_id=request.id,
                            arguments=request.arguments,
                            result=result.result if result is not None else None,
                        ),
                        convention=call.convention,
                        synthetic=True,
                    )
                )
    if not derived:
        return steps
    return sorted(steps + derived, key=lambda s: (s.start_ns, s.id))


def _answer(request: MessagePart, later: list[Step]) -> tuple[Step | None, MessagePart | None]:
    """The first later model call whose input carries this request's result."""
    for call in later:
        for message in call.model.input:  # type: ignore[union-attr]
            for part in message.parts:
                if part.type == "tool_result" and request.id and part.id == request.id:
                    return call, part
    return None, None


def _error_text(result: MessagePart | None) -> str | None:
    if result is None or not result.is_error:
        return None
    return result.result if isinstance(result.result, str) else "tool error"
