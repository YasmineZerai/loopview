// The Tools tab: across many runs, which tools fail, what the agent does after a
// failure, which tools it mixes up and which ones it is offered but never uses.
// The server computes the report (loopview/tools/report.py, DECISIONS D44); this
// view sorts and draws it. Every token number is an estimate and says so.

import { useEffect, useMemo, useRef, useState } from 'react'
import { api, STATIC_DEMO } from '../../api'
import { useSelectedRun, useStore } from '../../store'
import {
  afterErrorBar,
  DEFAULT_SORT,
  describeAfterError,
  formatRate,
  MOVES,
  nextSort,
  plural,
  sortTools,
  summarySentence,
  viewState,
  type SortKey,
} from '../../tools/toolsModel'
import type { StepRef, ToolStats, ToolsReport } from '../../types'
import { JsonBlock } from '../details/JsonView'

type Scope = 'all' | 'session'

// Live runs change the report; refetch at most this often while they arrive.
const REFRESH_MS = 1500

export function ToolsView() {
  const runs = useStore((s) => s.runs)
  const sessionId = useSelectedRun()?.run.session_id ?? null
  const [scope, setScope] = useState<Scope>('all')
  const session = scope === 'session' && sessionId ? sessionId : undefined
  const [report, setReport] = useState<ToolsReport | null>(null)
  const [failed, setFailed] = useState(false)
  const loadedOnce = useRef(false) // the first fetch goes out at once, later ones are throttled

  // Changes whenever a run is added or receives spans.
  const runsKey = useMemo(() => [...runs.values()].map((r) => `${r.id}:${r.last_received_ns}`).join(','), [runs])
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      api
        .tools(session)
        .then((r) => {
          if (cancelled) return
          loadedOnce.current = true
          setReport(r)
          setFailed(false)
        })
        .catch(() => !cancelled && setFailed(true))
    }, loadedOnce.current ? REFRESH_MS : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [runsKey, session])

  const state = viewState(report, failed)
  return (
    <div className="absolute inset-0 overflow-auto bg-canvas" style={{ '--tab': 'var(--color-view-tools)' } as React.CSSProperties}>
      <div className="mx-auto max-w-[1080px] px-6 pt-5 pb-24">
        <header className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="view-ink text-[11px] font-medium uppercase tracking-wider">Tools across runs</div>
            <p className="mt-1 text-[15px] leading-snug">
              {state === 'ready' || state === 'no-calls' ? <Headline text={summarySentence(report!)} /> : ' '}
            </p>
          </div>
          {!STATIC_DEMO && (
            <div className="flex rounded-md border border-border bg-surface p-0.5 text-[11.5px]">
              {(['all', 'session'] as const).map((s) => (
                <button
                  key={s}
                  disabled={s === 'session' && !sessionId}
                  onClick={() => setScope(s)}
                  title={s === 'session' && !sessionId ? 'The selected run is not part of a session' : undefined}
                  className={`rounded px-2 py-0.5 disabled:cursor-default disabled:opacity-40 ${scope === s ? 'bg-overlay-strong text-text' : 'text-muted hover:text-text'}`}
                >
                  {s === 'all' ? 'All runs' : 'This session'}
                </button>
              ))}
            </div>
          )}
        </header>

        {state === 'loading' && <Note>Loading…</Note>}
        {state === 'failed' && <Note>Couldn't load the tools report. Is the loopview server still running?</Note>}
        {state === 'no-runs' && <Note>No runs yet.</Note>}
        {state === 'no-calls' && <Note>No finished tool calls in {scope === 'session' ? 'this session' : 'these runs'} yet.</Note>}
        {state === 'ready' && (
          <>
            <ToolTable tools={report!.tools} />
            <NeverCalled report={report!} />
          </>
        )}
      </div>
    </div>
  )
}

/** The summary sentence, with its numbers in the view's accent. */
function Headline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d[\d,]*%?)/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="view-ink font-semibold">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="pt-16 text-center text-[13px] text-muted">{children}</p>
}

// --- the table ---------------------------------------------------------------------

const COLUMNS: { key: SortKey | null; label: string; title?: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Tool' },
  { key: 'calls', label: 'Calls', numeric: true },
  { key: 'errors', label: 'Errors', numeric: true, title: 'Calls the trace marks as failed (status error, an exception, or an MCP isError result)' },
  { key: 'error_rate', label: 'Error rate', numeric: true },
  { key: null, label: 'After an error', title: "What the agent did next, once the error was back in front of the model" },
  { key: 'avg_result_tokens_estimate', label: 'Avg result', numeric: true, title: 'Average size of a successful result, in tokens (estimated: characters / 4)' },
]

function ToolTable({ tools }: { tools: ToolStats[] }) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => sortTools(tools, sort.key, sort.dir), [tools, sort])

  return (
    <section className="mt-5">
      <Legend />
      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}
                  aria-sort={c.key === sort.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  title={c.title}
                >
                  {c.key ? (
                    <button className="uppercase tracking-wider hover:text-text" onClick={() => setSort(nextSort(sort, c.key!))}>
                      {c.label}
                      {c.key === 'avg_result_tokens_estimate' && <span className="normal-case tracking-normal"> (est.)</span>}
                      <span className="ml-1 inline-block w-2">{c.key === sort.key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <ToolRow key={t.name} tool={t} open={open === t.name} onToggle={() => setOpen(open === t.name ? null : t.name)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ToolRow({ tool, open, onToggle }: { tool: ToolStats; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={`cursor-pointer border-b border-border last:border-b-0 hover:bg-overlay-soft ${open ? 'bg-overlay-soft' : ''}`} onClick={onToggle}>
        <td className="px-3 py-2">
          <button className="font-mono font-medium" aria-expanded={open} onClick={(e) => (e.stopPropagation(), onToggle())}>
            <span className="mr-1.5 inline-block w-2 text-muted">{open ? '▾' : '▸'}</span>
            {tool.name}
          </button>
        </td>
        <td className="px-3 py-2 text-right font-mono">{tool.calls.toLocaleString('en-US')}</td>
        <td className={`px-3 py-2 text-right font-mono ${tool.errors ? '' : 'text-muted'}`}>{tool.errors.toLocaleString('en-US')}</td>
        <td className={`px-3 py-2 text-right font-mono ${tool.errors ? '' : 'text-muted'}`}>{formatRate(tool.error_rate)}</td>
        <td className="px-3 py-2">
          <AfterErrorBar tool={tool} />
        </td>
        <td className="px-3 py-2 text-right font-mono text-muted">
          {tool.avg_result_tokens_estimate === null ? '–' : `~${tool.avg_result_tokens_estimate.toLocaleString('en-US')} tok`}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border last:border-b-0">
          <td colSpan={COLUMNS.length} className="bg-canvas/50 px-5 py-4">
            <ToolDetail tool={tool} />
          </td>
        </tr>
      )}
    </>
  )
}

/** A stacked bar of what happened after each error, with a 2px gap between parts. */
export function AfterErrorBar({ tool }: { tool: ToolStats }) {
  const segments = afterErrorBar(tool.after_error)
  if (segments.length === 0) return <span className="text-[11.5px] text-muted">no errors</span>
  return (
    <div className="flex items-center gap-2" title={describeAfterError(tool.after_error)}>
      <div className="flex h-2.5 w-[140px] gap-[2px]" role="img" aria-label={describeAfterError(tool.after_error)}>
        {segments.map((s) => (
          <span
            key={s.id}
            className={`move-${s.id} h-full rounded-[3px]`}
            style={{ width: `${s.share * 100}%`, minWidth: 3 }}
            title={`${s.label}: ${s.count} (${Math.round(s.share * 100)}%)`}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-muted">{tool.errors}</span>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11.5px] text-muted">
      <span className="text-text">After an error:</span>
      {MOVES.map((m) => (
        <span key={m.id} className="flex items-center gap-1.5" title={m.hint}>
          <span className={`move-${m.id} inline-block h-2.5 w-2.5 rounded-[3px]`} />
          {m.label}
        </span>
      ))}
    </div>
  )
}

// --- one tool, opened -----------------------------------------------------------------

function ToolDetail({ tool }: { tool: ToolStats }) {
  const runs = useStore((s) => s.runs)
  const a = tool.after_error
  return (
    <div className="grid gap-5 text-[12.5px] md:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-3">
        <h3 className="text-[11px] uppercase tracking-wider text-muted">Most common errors</h3>
        {tool.top_errors.length === 0 && <p className="text-muted">This tool never reported an error.</p>}
        {tool.top_errors.map((e) => (
          <div key={e.message_group} className="space-y-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-start gap-2">
              <span className="shrink-0 rounded bg-overlay px-1.5 font-mono text-[11px] leading-5">×{e.count}</span>
              <code className="min-w-0 break-words font-mono text-[12px] leading-5">{e.message_group}</code>
            </div>
            <div className="text-[11.5px] text-muted">
              For example: <span className="break-words text-text">{e.example_message}</span>
            </div>
            <JsonBlock value={e.example_args ?? null} label="Arguments of that call" />
            <StepLink stepRef={e.step_ref} label="Show this call in the graph" />
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {tool.errors > 0 && (
          <div>
            <h3 className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">After an error</h3>
            <ul className="space-y-0.5">
              <li>{plural(a.blind_retry, 'blind retry', 'blind retries')}</li>
              <li>
                {a.fixed} with fixed arguments{a.fixed > 0 && <span className="text-muted"> ({a.fixed_succeeded} worked)</span>}
              </li>
              <li>{a.switched} switched tool</li>
              <li>{a.gave_up} gave up</li>
            </ul>
          </div>
        )}
        <div>
          <h3 className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Switched to, after failing</h3>
          {tool.confused_with.length === 0 ? (
            <p className="text-muted">No tool it was swapped for twice or more.</p>
          ) : (
            <ul className="space-y-0.5 font-mono">
              {tool.confused_with.map((c) => (
                <li key={c.tool}>
                  → {c.tool} <span className="text-muted">×{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Calls</h3>
          <div className="flex flex-wrap gap-1">
            {tool.step_refs.slice(0, MAX_CALL_LINKS).map((ref, i) => (
              <StepLink key={ref.step_id} stepRef={ref} label={`${i + 1}`} title={`Run ${runs.get(ref.run_id)?.name ?? ref.run_id.slice(0, 8)}`} compact />
            ))}
            {tool.step_refs.length > MAX_CALL_LINKS && <span className="text-[11.5px] text-muted">and {tool.step_refs.length - MAX_CALL_LINKS} more</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

const MAX_CALL_LINKS = 40

function StepLink({ stepRef, label, title, compact = false }: { stepRef: StepRef; label: string; title?: string; compact?: boolean }) {
  const openStep = useStore((s) => s.openStep)
  return (
    <button
      className={compact
        ? 'min-w-6 rounded border border-border bg-surface px-1 font-mono text-[11px] leading-5 text-muted hover:border-muted/60 hover:text-text'
        : 'text-[12px] text-accent hover:underline'}
      title={title ?? 'Open the run and show this call in the graph'}
      onClick={() => openStep(stepRef.run_id, stepRef.step_id)}
    >
      {label}
      {!compact && ' →'}
    </button>
  )
}

// --- offered but never used -----------------------------------------------------------

function NeverCalled({ report }: { report: ToolsReport }) {
  if (!report.tool_list_recorded) {
    return (
      <section className="mt-8">
        <h2 className="text-[11px] uppercase tracking-wider text-muted">Never called</h2>
        <p className="mt-2 text-[12.5px] text-muted">
          Tool list not recorded: these traces don't say which tools the model was offered, so unused tools can't be found.
        </p>
      </section>
    )
  }
  return (
    <section className="mt-8">
      <h2 className="text-[11px] uppercase tracking-wider text-muted">Never called</h2>
      {report.never_called.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-muted">Every tool the model was offered was called at least once.</p>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] text-muted">
            Offered to the model, never called. Their definitions are sent with every model call that offers them.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-3 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 text-right font-medium">Model calls that carried it</th>
                  <th className="px-3 py-2 text-right font-medium" title="Definition length / 4, times the model calls that carried it">
                    Definition cost <span className="normal-case tracking-normal">(est.)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.never_called.map((t) => (
                  <tr key={t.name} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono">{t.name}</td>
                    <td className="px-3 py-2 text-right font-mono">{t.carried_by_model_calls.toLocaleString('en-US')}</td>
                    <td className="px-3 py-2 text-right font-mono">~{t.definition_tokens_estimate.toLocaleString('en-US')} tok</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
