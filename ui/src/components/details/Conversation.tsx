// A model call rendered as a readable conversation.
//
// What matters first comes first: the model's output, then what is new in its
// input (the user's message or the tool results it is answering). A call's input
// repeats the whole history and the system prompt, so those are folded away.

import { useState, type ReactNode } from 'react'
import type { Message, MessagePart, ModelCall } from '../../types'
import { formatTokens } from '../../theme'
import { Markdown } from '../Markdown'
import { Chevron } from '../icons'
import { JsonBlock } from './JsonView'
import { parsedIfJson, splitCall, summarize } from '../../details/brief'

const ROLE_STYLE: Record<string, string> = {
  system: 'text-muted border-border',
  user: 'text-role-user border-role-user/40',
  assistant: 'text-role-assistant border-role-assistant/40',
  tool: 'text-role-tool border-role-tool/40',
}

export function Conversation({ call }: { call: ModelCall }) {
  const { system, history, latest, output } = splitCall(call)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
        <span className="text-text">{call.model ?? 'model'}</span>
        {call.provider && <span>{call.provider}</span>}
        {call.usage?.input_tokens != null && <span>{formatTokens(call.usage.input_tokens)} in</span>}
        {call.usage?.output_tokens != null && <span>{formatTokens(call.usage.output_tokens)} out</span>}
        {!!call.usage?.cache_read_tokens && <span>{formatTokens(call.usage.cache_read_tokens)} cached</span>}
        {!!call.usage?.reasoning_tokens && <span>{formatTokens(call.usage.reasoning_tokens)} thinking</span>}
      </div>
      <Section title="Output">
        {output.length ? output.map((m, i) => <MessageView key={i} message={m} />) : <Empty what="output" />}
      </Section>
      <Section title={history.length ? 'New in this call' : 'Input'}>
        {latest.length ? latest.map((m, i) => <MessageView key={i} message={m} />) : <Empty what="input" />}
      </Section>
      {system.length > 0 && (
        <Folded title="System prompt">
          {system.map((m, i) => (
            <MessageView key={i} message={m} />
          ))}
        </Folded>
      )}
      {history.length > 0 && (
        <Folded title={`Earlier messages (${history.length})`}>
          {history.map((m, i) => (
            <MessageView key={i} message={m} />
          ))}
        </Folded>
      )}
    </div>
  )
}

/** Text, or JSON when the text is JSON (structured output): shown as JSON. */
export function TextOrJson({ text }: { text: string }) {
  const parsed = parsedIfJson(text)
  if (parsed !== text) return <JsonBlock value={parsed} open />
  return <Markdown text={text} className="text-[13px] text-text/90" />
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  )
}

/** Closed until clicked: content that is sent again on every call. */
export function Folded({ title, children, open: initial = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <div>
      <button className="flex items-center gap-1 text-[11px] text-muted hover:text-text" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Chevron size={12} className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        {title}
      </button>
      {open && <div className="mt-1.5 space-y-2">{children}</div>}
    </div>
  )
}

function Empty({ what }: { what: string }) {
  return <p className="text-[12px] italic text-muted">No {what} recorded.</p>
}

function MessageView({ message }: { message: Message }) {
  const style = ROLE_STYLE[message.role] ?? 'text-muted border-border'
  const [text, border] = style.split(' ')
  return (
    <div className={`rounded-lg border-l-2 bg-overlay-soft py-2 pl-3 pr-2 ${border}`}>
      <div className={`mb-1 text-[10.5px] uppercase tracking-wider ${text}`}>{message.role}</div>
      <div className="space-y-2">
        {message.parts.map((part, i) => (
          <PartView key={i} part={part} />
        ))}
      </div>
    </div>
  )
}

function PartView({ part }: { part: MessagePart }) {
  if (part.type === 'text') return <TextOrJson text={part.text ?? ''} />
  if (part.type === 'reasoning') {
    return (
      <div className="rounded-md border-l-2 border-role-thinking/40 py-1 pl-2">
        <div className="mb-0.5 text-[10.5px] uppercase tracking-wider text-role-thinking">thinking</div>
        <p className="whitespace-pre-wrap break-words text-[12.5px] italic leading-relaxed text-muted">
          {part.text || 'The provider did not return the thinking text.'}
        </p>
      </div>
    )
  }
  if (part.type === 'tool_call') return <JsonBlock label={`calls ${part.name ?? 'tool'}`} value={part.arguments ?? {}} open />
  if (part.type === 'tool_result') {
    // Results are often huge: one line until opened.
    return (
      <Folded title={`${part.name ? `${part.name} result` : 'tool result'} · ${summarize(part.result)}`}>
        <JsonBlock value={parsedIfJson(part.result ?? null)} />
      </Folded>
    )
  }
  return (
    <p className="text-[12px] italic text-muted">
      {part.name ?? 'content'}
      {part.text ? `: ${part.text}` : ''}
    </p>
  )
}
