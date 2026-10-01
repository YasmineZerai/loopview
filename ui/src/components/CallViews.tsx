// How one model call or tool call is shown: its thinking, its reply, the tools
// it asked for; a tool's arguments and its result or error.
//
// Shared by the activity feed and the expanded graph cards, so a call reads the
// same wherever you look at it.

import { useState } from 'react'
import { formatDuration, formatTokens } from '../theme'
import type { MessagePart, Step } from '../types'
import { JsonBlock } from './details/JsonView'
import { ArrowRight, Sparkle, Thought, Wrench } from './icons'
import { Markdown } from './Markdown'

/** Model and tool calls in reading order. On a timestamp tie (fast tools,
 * coarse clocks), a tool result comes before the model call that reads it. */
export function orderCalls(steps: Step[]): Step[] {
  return steps
    .filter((s) => !s.hidden && (s.kind === 'model_call' || s.kind === 'tool_call'))
    .sort((a, b) => a.start_ns - b.start_ns || (a.kind === 'tool_call' ? -1 : 1) - (b.kind === 'tool_call' ? -1 : 1))
}

export function isRunning(step: Step, time: number) {
  return step.end_ns === null || step.end_ns > time
}

export function CallView({ step, time }: { step: Step; time: number }) {
  return step.kind === 'model_call' ? (
    <ModelEntry step={step} running={isRunning(step, time)} />
  ) : (
    <ToolEntry step={step} running={isRunning(step, time)} />
  )
}

function ModelEntry({ step, running }: { step: Step; running: boolean }) {
  const model = step.model
  const parts = (model?.output ?? []).flatMap((m) => m.parts)
  const tokens = (model?.input_tokens ?? 0) + (model?.output_tokens ?? 0)
  if (running) {
    return (
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <Sparkle size={12} /> <span className="animate-pulse">thinking…</span>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {parts.length === 0 && <p className="text-[12px] italic text-muted">No output recorded.</p>}
      {parts.map((part, i) => (
        <Part key={i} part={part} />
      ))}
      <div className="flex gap-2 font-mono text-[10.5px] text-muted">
        <span>{model?.model ?? 'model'}</span>
        {tokens > 0 && <span>{formatTokens(tokens)} tok</span>}
        {step.end_ns !== null && <span>{formatDuration(step.end_ns - step.start_ns)}</span>}
      </div>
    </div>
  )
}

function Part({ part }: { part: MessagePart }) {
  if (part.type === 'reasoning') return <Thinking text={part.text ?? ''} />
  if (part.type === 'text' && part.text) return <ClampedMarkdown text={part.text} />
  if (part.type === 'tool_call') {
    return (
      <div className="flex items-start gap-1.5 font-mono text-[11.5px]">
        <ArrowRight size={12} className="mt-0.75 shrink-0 text-role-tool" />
        <span className="min-w-0">
          <span className="font-semibold text-role-tool">{part.name}</span>
          <LongText text={args(part.arguments)} className="text-muted" wrap />
        </span>
      </div>
    )
  }
  return null
}

function Thinking({ text }: { text: string }) {
  return (
    <div className="rounded-md border-l-2 border-role-thinking/40 bg-overlay-soft py-1 pl-2 pr-1">
      <div className="mb-0.5 flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-role-thinking">
        <Thought size={11} /> thinking
      </div>
      <Clamped text={text} className="text-[12px] italic text-muted" lines={3} />
    </div>
  )
}

function ToolEntry({ step, running }: { step: Step; running: boolean }) {
  const [open, setOpen] = useState(false)
  const tool = step.tool
  const failed = !running && step.status === 'error'
  return (
    <div className="space-y-1 font-mono text-[11.5px]">
      <div className="flex items-start gap-1.5">
        <Wrench size={12} className="mt-0.75 shrink-0 text-muted" />
        <span className="min-w-0">
          <span className="font-semibold">{step.name}</span>
          <LongText text={args(tool?.arguments)} className="text-muted" wrap />
        </span>
      </div>
      {running ? (
        <div className="animate-pulse pl-4.5 text-muted">running…</div>
      ) : failed ? (
        <div className="ml-4.5 rounded border border-state-error/40 bg-state-error/10 px-2 py-1 text-state-error">
          {step.error ?? 'failed'}
        </div>
      ) : (
        <div className="flex items-start gap-1.5 pl-0.5">
          <span className="mt-px shrink-0 text-state-ok">←</span>
          {open ? (
            <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
              <JsonBlock value={tool?.result ?? null} open />
            </div>
          ) : (
            <button
              className="min-w-0 break-all text-left text-text/80 hover:text-text"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(true)
              }}
              title="Show the full result"
            >
              {truncate(compact(tool?.result), 220)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Long text, clamped to a few lines; click to expand. */
function Clamped({ text, className, lines = 6 }: { text: string; className: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > lines * 70
  return (
    <p
      className={`wrap-break-word whitespace-pre-wrap leading-relaxed ${className}`}
      style={open || !long ? undefined : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      onClick={(e) => {
        if (!long) return
        e.stopPropagation()
        setOpen(!open)
      }}
    >
      {text}
    </p>
  )
}

/** A model reply, rendered as Markdown and clamped when long; click to expand. */
function ClampedMarkdown({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 420
  return (
    <div
      className={long && !open ? 'relative max-h-40 overflow-hidden' : ''}
      onClick={(e) => {
        if (!long) return
        e.stopPropagation()
        setOpen(!open)
      }}
    >
      <Markdown text={text} className="text-[12.5px] text-text" />
      {long && !open && <div className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-surface to-transparent" />}
    </div>
  )
}

/** Text that's cut at 180 characters until clicked. `wrap` adds the call's
 * parentheses around it. */
function LongText({ text, className, wrap = false }: { text: string; className: string; wrap?: boolean }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 180
  const shown = long && !open ? truncate(text, 180) : text
  return (
    <span
      className={`break-all ${className} ${long ? 'cursor-pointer hover:text-text' : ''}`}
      title={long && !open ? 'Show everything' : undefined}
      onClick={(e) => {
        if (!long) return
        e.stopPropagation()
        setOpen(!open)
      }}
    >
      {wrap ? `(${shown})` : shown}
    </span>
  )
}

/** Tool arguments as a call reads: run_benchmark(database: "duckdb"). */
function args(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : compact(v)}`)
      .join(', ')
  }
  return compact(value)
}

/** A value on one line: strings as they are, everything else as compact JSON. */
function compact(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    const json = JSON.stringify(value)
    // {"database":"duckdb"} reads better as {database: "duckdb"}
    return json.replace(/"([a-zA-Z_][\w]*)":/g, '$1: ').replace(/,(?=\S)/g, ', ')
  } catch {
    return String(value)
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
