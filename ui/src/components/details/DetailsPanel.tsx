// The right slide-over: everything one graph node did, execution by execution.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelectedRun, useStore } from '../../store'
import { formatDuration } from '../../theme'
import type { Step } from '../../types'
import { StatusMark } from '../StatusMark'
import { Chevron, Cross, Sparkle, Wrench } from '../icons'
import { Conversation } from './Conversation'
import { JsonBlock } from './JsonView'

export function DetailsPanel() {
  const loaded = useSelectedRun()
  const selectedKey = useStore((s) => s.selectedKey)
  const setSelectedKey = useStore((s) => s.setSelectedKey)
  const highlight = useStore((s) => s.highlightStep)

  const executions = useMemo(() => {
    if (!loaded || !selectedKey) return []
    return loaded.view.steps.filter((s) => s.key === selectedKey && !s.hidden)
  }, [loaded, selectedKey])

  const open = selectedKey !== null && executions.length > 0
  const first = executions[0]
  return (
    <aside
      className={`absolute inset-y-0 right-0 z-20 flex w-[var(--details-width)] max-w-[92vw] flex-col border-l border-border bg-surface/95 shadow-2xl backdrop-blur-md transition-transform duration-250 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      {first && loaded && (
        <>
          <header className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] uppercase tracking-wider text-muted">{first.type_label}</div>
              <h2 className="truncate font-mono text-[15px] font-semibold">{first.name}</h2>
              <div className="mt-1 text-[12px] text-muted">
                {executions.length} execution{executions.length > 1 ? 's' : ''} · {first.convention}
              </div>
            </div>
            <button className="rounded-md p-1.5 text-muted hover:bg-overlay-strong hover:text-text" onClick={() => setSelectedKey(null)}>
              <Cross size={16} />
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {executions.map((step, i) => (
              // Keyed by the highlight too, so a new jump re-opens the right execution.
              <Execution key={`${step.id}:${highlight}`} step={step} index={i} total={executions.length} all={loaded.view.steps} highlight={highlight} />
            ))}
          </div>
        </>
      )}
    </aside>
  )
}

function Execution({ step, index, total, all, highlight }: { step: Step; index: number; total: number; all: Step[]; highlight: string | null }) {
  const calls = all.filter((s) => s.scope_id === step.id && !s.hidden && (s.kind === 'model_call' || s.kind === 'tool_call'))
  // The last execution starts open, or the one holding a call the Tools tab pointed at.
  const holdsHighlight = highlight !== null && calls.some((c) => c.id === highlight)
  const [open, setOpen] = useState(highlight !== null && all.some((s) => s.id === highlight) ? holdsHighlight : index === total - 1)
  const duration = step.end_ns !== null ? formatDuration(step.end_ns - step.start_ns) : 'running'
  return (
    <section className="rounded-xl border border-border bg-canvas/40">
      <button className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left" onClick={() => setOpen(!open)}>
        <Chevron size={13} className={`text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <StatusMark status={step.status} size={13} />
        <span className="text-[13px]">Run {index + 1}</span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {calls.filter((c) => c.kind === 'model_call').length} llm · {calls.filter((c) => c.kind === 'tool_call').length} tools ·{' '}
          {duration}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3.5 py-3">
          {step.error && <ErrorBox message={step.error} />}
          {calls.length === 0 && step.input != null && <JsonBlock label="input" value={step.input} />}
          {calls.map((call) => (call.kind === 'model_call' ? <ModelCallView key={call.id} step={call} /> : <ToolCallView key={call.id} step={call} highlighted={call.id === highlight} />))}
          {calls.length === 0 && step.output != null && <JsonBlock label="output" value={step.output} />}
          {step.kind === 'unknown' && <JsonBlock label="attributes" value={step.attributes} />}
        </div>
      )}
    </section>
  )
}

function ModelCallView({ step }: { step: Step }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
        <Sparkle size={12} /> model call
        <span className="ml-auto font-mono">{step.end_ns ? formatDuration(step.end_ns - step.start_ns) : 'running'}</span>
      </div>
      {step.model ? <Conversation call={step.model} /> : null}
    </div>
  )
}

function ToolCallView({ step, highlighted = false }: { step: Step; highlighted?: boolean }) {
  const tool = step.tool
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])
  return (
    <div
      ref={ref}
      className={`rounded-lg border p-3 ${step.status === 'error' ? 'border-state-error/50' : 'border-border'} ${highlighted ? 'ring-2 ring-accent' : ''}`}
    >
      <div className="mb-2 flex items-center gap-2 text-[12px]">
        <Wrench size={12} className="text-muted" />
        <span className="font-mono">{step.name}</span>
        <StatusMark status={step.status} size={12} />
        <span className="ml-auto font-mono text-[11px] text-muted">
          {step.end_ns ? formatDuration(step.end_ns - step.start_ns) : 'running'}
        </span>
      </div>
      <div className="space-y-2">
        {step.error && <ErrorBox message={step.error} />}
        {tool?.arguments != null && <JsonBlock label="arguments" value={tool.arguments} open />}
        {tool?.result != null && <JsonBlock label="result" value={tool.result} />}
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-state-error/40 bg-state-error/10 px-3 py-2 font-mono text-[12px] text-state-error">
      {message}
    </div>
  )
}
