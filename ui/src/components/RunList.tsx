// The left sidebar: recent runs, grouped by session when runs share one.

import { useRef } from 'react'
import { api, STATIC_DEMO, type DemoAbout } from '../api'
import { isPhone } from '../phone'
import { useStore } from '../store'
import { formatDuration, timeAgo } from '../theme'
import type { RunInfo } from '../types'
import { useDemoCatalog } from './demo/demoState'
import { StatusMark } from './StatusMark'
import { Upload } from './icons'

export function RunList() {
  const runs = useStore((s) => s.runs)
  const selectedRunId = useStore((s) => s.selectedRunId)
  const selectRun = useStore((s) => s.selectRun)
  const fileInput = useRef<HTMLInputElement>(null)
  const catalog = useDemoCatalog()

  // The demo keeps its examples in the order they were picked, best first.
  const list = STATIC_DEMO ? [...runs.values()] : [...runs.values()].sort((a, b) => b.start_ns - a.start_ns)
  // Sessions with more than one run get a header; single runs stay flat.
  const sessionCounts = new Map<string, number>()
  for (const r of list) if (r.session_id) sessionCounts.set(r.session_id, (sessionCounts.get(r.session_id) ?? 0) + 1)
  const seenSessions = new Set<string>()

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-[11px] uppercase tracking-wider text-muted">{STATIC_DEMO ? 'Example runs' : 'Runs'}</span>
        <button
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-overlay hover:text-text ${STATIC_DEMO ? 'hidden' : ''}`}
          onClick={() => fileInput.current?.click()}
          title="Import a run exported as JSONL"
        >
          <Upload size={13} /> Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".jsonl,.ndjson,application/x-ndjson"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const { trace_ids } = await api.importFile(file)
            if (trace_ids[0]) selectRun(trace_ids[0], true)
            e.target.value = ''
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {list.length === 0 && <p className="px-2 py-3 text-[12px] text-muted">No runs yet.</p>}
        {list.map((run) => {
          const sessionHeader =
            run.session_id && (sessionCounts.get(run.session_id) ?? 0) > 1 && !seenSessions.has(run.session_id)
          if (run.session_id) seenSessions.add(run.session_id)
          return (
            <div key={run.id}>
              {sessionHeader && (
                <div className="mt-2 truncate px-2 pb-1 font-mono text-[10.5px] text-muted">
                  session {run.session_id!.slice(0, 12)} · {sessionCounts.get(run.session_id!)} runs
                </div>
              )}
              <RunItem
                run={run}
                about={catalog.get(run.id)}
                selected={run.id === selectedRunId}
                onClick={() => {
                  selectRun(run.id, true)
                  if (isPhone()) useStore.setState({ sidebarOpen: false }) // the drawer gets out of the way
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RunItem({ run, about, selected, onClick }: { run: RunInfo; about?: DemoAbout; selected: boolean; onClick: () => void }) {
  if (about) return <DemoRunItem run={run} about={about} selected={selected} onClick={onClick} />
  return (
    <button
      onClick={onClick}
      className={`mb-1 w-full rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${selected ? 'border-border bg-surface shadow-sm' : 'border-transparent hover:bg-overlay'}`}
    >
      <div className="flex items-center gap-2">
        <StatusMark status={run.status} size={12} />
        <span className="truncate font-mono text-[12.5px] text-text">{run.name}</span>
      </div>
      <div className="mt-0.5 flex gap-2 pl-5 text-[11px] text-muted">
        <span>{run.status === 'running' ? 'live' : timeAgo(run.start_ns)}</span>
        {run.end_ns !== null && <span className="font-mono">{formatDuration(run.end_ns - run.start_ns)}</span>}
        <span className="font-mono">{run.step_count} spans</span>
      </div>
      {run.service_name && <div className="truncate pl-5 text-[10.5px] text-muted/70">{run.service_name}</div>}
    </button>
  )
}

/** In the demo: what the example is, rather than when it was recorded. */
function DemoRunItem({ run, about, selected, onClick }: { run: RunInfo; about: DemoAbout; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={about.summary}
      className={`mb-1 w-full rounded-lg border px-3 py-2 text-left transition-colors duration-150 ${selected ? 'border-border bg-surface shadow-sm' : 'border-transparent hover:bg-overlay'}`}
    >
      <div className="flex items-center gap-2">
        <StatusMark status={run.status} size={12} />
        <span className="truncate text-[12.5px] font-medium text-text">{about.title}</span>
      </div>
      <div className="mt-0.5 flex gap-2 pl-5 text-[11px] text-muted">
        <span>{about.framework}</span>
        {run.end_ns !== null && <span className="font-mono">{formatDuration(run.end_ns - run.start_ns)}</span>}
      </div>
    </button>
  )
}
