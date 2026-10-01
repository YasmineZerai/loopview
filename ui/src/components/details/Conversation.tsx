// A model call rendered as a readable conversation.
//
// A call's input usually repeats the whole history, so by default we show only
// what is new: the system prompt, the last input message, and the output.

import { useState } from 'react'
import type { Message, ModelCall } from '../../types'
import { formatTokens } from '../../theme'
import { JsonBlock } from './JsonView'

const ROLE_STYLE: Record<string, string> = {
  system: 'text-muted border-border',
  user: 'text-[#7c9cff] border-[#7c9cff]/40',
  assistant: 'text-[#c084fc] border-[#c084fc]/40',
  tool: 'text-[#f5b94a] border-[#f5b94a]/40',
}

export function Conversation({ call }: { call: ModelCall }) {
  const [full, setFull] = useState(false)
  const system = call.input.filter((m) => m.role === 'system')
  const rest = call.input.filter((m) => m.role !== 'system')
  const shown = full ? rest : rest.slice(-1)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
        <span className="text-text">{call.model ?? 'model'}</span>
        {call.provider && <span>{call.provider}</span>}
        {call.input_tokens != null && <span>{formatTokens(call.input_tokens)} in</span>}
        {call.output_tokens != null && <span>{formatTokens(call.output_tokens)} out</span>}
      </div>
      {system.map((m, i) => (
        <MessageView key={`s${i}`} message={m} clamp />
      ))}
      {rest.length > 1 && (
        <button className="text-[11px] text-muted underline-offset-2 hover:text-text hover:underline" onClick={() => setFull(!full)}>
          {full ? 'Show only the latest input' : `Show full input (${rest.length} messages)`}
        </button>
      )}
      {shown.map((m, i) => (
        <MessageView key={`i${i}`} message={m} />
      ))}
      {call.output.map((m, i) => (
        <MessageView key={`o${i}`} message={m} output />
      ))}
    </div>
  )
}

function MessageView({ message, output = false, clamp = false }: { message: Message; output?: boolean; clamp?: boolean }) {
  const [expanded, setExpanded] = useState(!clamp)
  const style = ROLE_STYLE[message.role] ?? 'text-muted border-border'
  return (
    <div className={`rounded-lg border-l-2 bg-white/[0.03] py-2 pl-3 pr-2 ${style.split(' ')[1]}`}>
      <div className={`mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-wider ${style.split(' ')[0]}`}>
        {message.role}
        {output && <span className="text-muted normal-case tracking-normal">output</span>}
      </div>
      <div className="space-y-2">
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <p
                key={i}
                onClick={() => clamp && setExpanded(!expanded)}
                className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text/90 ${expanded ? '' : 'line-clamp-3 cursor-pointer'}`}
              >
                {part.text}
              </p>
            )
          }
          if (part.type === 'tool_call') {
            return <JsonBlock key={i} label={`calls ${part.name ?? 'tool'}`} value={part.arguments ?? {}} open />
          }
          if (part.type === 'tool_result') {
            return <JsonBlock key={i} label="tool result" value={part.result ?? null} />
          }
          return (
            <p key={i} className="text-[12px] italic text-muted">
              {part.name ?? 'content'}
              {part.text ? `: ${part.text}` : ''}
            </p>
          )
        })}
      </div>
    </div>
  )
}
