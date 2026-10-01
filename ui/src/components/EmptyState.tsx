// What a first-time visitor sees: where to point the exporter, and a demo button.

import { useState } from 'react'
import { api } from '../api'
import { otlpEndpoint } from '../endpoint'
import { useStore } from '../store'
import { CopyButton } from './details/CopyButton'
import { Logo, Play } from './icons'

export function EmptyState() {
  const endpoint = otlpEndpoint(window.location.origin)
  const snippet = `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${endpoint}\nexport OTEL_BSP_SCHEDULE_DELAY=100`
  const [loading, setLoading] = useState(false)
  const selectRun = useStore((s) => s.selectRun)

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="fade-in w-full max-w-[640px]">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={28} />
          <h1 className="text-[22px] font-semibold tracking-tight">Waiting for your agent</h1>
        </div>
        <p className="mb-6 text-[14px] leading-relaxed text-muted">
          Point any OpenTelemetry exporter at loopview and run your agent. The graph builds itself as
          the run unfolds: agents, nodes, tool calls and the control flow between them.
        </p>

        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">OTLP endpoint</label>
        <div className="mb-5 flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5">
          <code className="font-mono text-[13px] text-accent">{endpoint}</code>
          <CopyButton text={endpoint} />
        </div>

        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted">Set up, in the shell that runs your agent</label>
        <div className="mb-7 rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-end border-b border-border px-2 py-1">
            <CopyButton text={snippet} />
          </div>
          <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-6 text-text/90">{snippet}</pre>
        </div>

        <div className="flex items-center gap-4">
          <button
            disabled={loading}
            onClick={async () => {
              setLoading(true)
              const { trace_ids } = await api.loadDemo()
              if (trace_ids[0]) selectRun(trace_ids[0], true)
              setLoading(false)
            }}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-white px-4 py-2.5 text-[13.5px] font-medium text-canvas transition-transform duration-150 hover:scale-[1.02] disabled:opacity-60"
          >
            <Play size={13} /> Load the demo run
          </button>
          <span className="text-[12.5px] text-muted">A supervisor, three parallel workers, a critic loop and a handoff.</span>
        </div>
      </div>
    </div>
  )
}
