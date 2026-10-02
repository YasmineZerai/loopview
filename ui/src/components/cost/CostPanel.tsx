// The Cost tab: where the money in a run goes, up to the current moment.
//
// Totals are the providers' reported usage. The split into segments is
// estimated on the server from the recorded content and scaled to those totals
// (DECISIONS D38 to D41); this panel only sums and draws it.

import { useEffect, useMemo, useState } from 'react'
import {
  cardsWhereLargest,
  formatDollars,
  formatPercent,
  formatTokenCount,
  GROUP_LABELS,
  SEGMENTS,
  summarizeCost,
  type Amount,
  type CostSummary,
} from '../../cost/costModel'
import { buildGraph } from '../../graph/buildGraph'
import { useSelectedRun, useStore } from '../../store'
import { formatDuration, hueMap, NEUTRAL_HUE } from '../../theme'
import type { CostSegmentName } from '../../types'
import { Cross } from '../icons'
import { SplitBar } from './SplitBar'

export function CostPanel() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const unit = useStore((s) => s.costUnit)
  const selectedKey = useStore((s) => s.selectedKey)
  const { setCostUnit, setSelectedKey, setCostHighlight, focusCard, setHoverKey } = useStore.getState()
  const [activeSegment, setActiveSegment] = useState<CostSegmentName | null>(null)

  const summary = useMemo(
    () => (loaded ? summarizeCost(loaded.view, time, selectedKey) : null),
    [loaded, time, selectedKey],
  )
  // Agent colours and names come from the full run, as in the graph.
  const graph = useMemo(() => (loaded ? buildGraph(loaded.view) : null), [loaded])
  const hues = useMemo(() => hueMap(graph ? graph.nodes.map((n) => n.agentKey) : []), [graph])
  const cardName = (key: string | null) => (key ? (graph?.nodes.find((n) => n.key === key)?.name ?? key) : 'run')

  // Hovering a segment highlights the cards where that segment is largest.
  useEffect(() => {
    setCostHighlight(summary && activeSegment ? cardsWhereLargest(summary, activeSegment, unit) : [])
  }, [summary, activeSegment, unit, setCostHighlight])
  useEffect(() => () => setCostHighlight([]), [setCostHighlight])

  if (!loaded || !summary) return null
  const value = (a: Amount) => (unit === 'dollars' ? formatDollars(a.dollars) : `${formatTokenCount(a.tokens)} tok`)
  const filtered = selectedKey !== null

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-[11px] uppercase tracking-wider text-muted">Cost</span>
        <div className="flex rounded-md border border-border p-0.5 text-[11px]">
          {(['dollars', 'tokens'] as const).map((u) => (
            <button
              key={u}
              onClick={() => setCostUnit(u)}
              className={`rounded px-2 py-0.5 font-mono ${unit === u ? 'bg-overlay-strong text-text' : 'text-muted hover:text-text'}`}
            >
              {u === 'dollars' ? '$' : 'tokens'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {filtered && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-overlay-soft px-3 py-2 text-[12px]">
            <span className="text-muted">Step</span>
            <span className="truncate font-mono">{cardName(selectedKey)}</span>
            <span className="text-muted">· {summary.calls.length} model call{summary.calls.length === 1 ? '' : 's'}</span>
            <button className="ml-auto rounded p-0.5 text-muted hover:bg-overlay hover:text-text" title="Back to the whole run (esc)" onClick={() => setSelectedKey(null)}>
              <Cross size={13} />
            </button>
          </div>
        )}

        <Total summary={summary} unit={unit} />

        {summary.total.tokens > 0 ? (
          <section>
            <SectionTitle>{unit === 'dollars' ? 'Where each dollar goes' : 'Where the tokens go'}</SectionTitle>
            <SplitBar split={summary.split} unit={unit} height={30} labels active={activeSegment} onHover={setActiveSegment} />
            <Breakdown summary={summary} unit={unit} active={activeSegment} onHover={setActiveSegment} />
            <p className="mt-2 text-[11px] text-muted">
              Totals as reported by the provider; the split is estimated from recorded content.
            </p>
          </section>
        ) : (
          <p className="text-[12.5px] text-muted">
            {filtered ? 'This step made no model calls with reported usage.' : 'No finished model calls yet.'}
          </p>
        )}

        {!filtered && summary.byAgent.length > 1 && (
          <section>
            <SectionTitle>By agent</SectionTitle>
            <div className="space-y-3">
              {summary.byAgent.map((agent) => (
                <div key={agent.agentKey ?? 'run'}>
                  <div className="mb-1 flex items-center gap-2 text-[12px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: (agent.agentKey && hues.get(agent.agentKey)) || NEUTRAL_HUE }} />
                    <span className="truncate font-mono">{agent.name}</span>
                    <span className="ml-auto font-mono text-muted">{value(agent.total)}</span>
                  </div>
                  <SplitBar split={agent.split} unit={unit} height={8} />
                </div>
              ))}
            </div>
          </section>
        )}

        {summary.top.length > 0 && (
          <section>
            <SectionTitle>{filtered ? 'Model calls' : 'Most expensive steps'}</SectionTitle>
            <div className="space-y-1">
              {summary.top.map((call) => (
                <button
                  key={call.step.id}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-overlay"
                  onMouseEnter={() => call.nodeKey && setHoverKey(call.nodeKey)}
                  onMouseLeave={() => setHoverKey(null)}
                  onClick={() => {
                    if (!call.nodeKey) return
                    setSelectedKey(call.nodeKey)
                    focusCard(call.nodeKey)
                  }}
                >
                  <div className="mb-1 flex items-center gap-2 text-[12px]">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: (call.agentKey && hues.get(call.agentKey)) || NEUTRAL_HUE }} />
                    <span className="truncate font-mono">
                      {call.agentKey && call.agentKey !== call.nodeKey ? `${cardName(call.agentKey)} › ` : ''}
                      {cardName(call.nodeKey)}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">+{formatDuration(call.step.start_ns - loaded.run.start_ns)}</span>
                    <span className="ml-auto shrink-0 font-mono">{value(call.total)}</span>
                  </div>
                  {call.status === 'content_not_recorded' ? (
                    <p className="text-[11px] text-muted">Content not recorded: total only.</p>
                  ) : (
                    <SplitBar split={call.split} unit={unit} height={6} />
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Total({ summary, unit }: { summary: CostSummary; unit: 'dollars' | 'tokens' }) {
  const priced = summary.calls.length - summary.unpricedCalls
  const main = unit === 'dollars' ? formatDollars(summary.total.dollars) : formatTokenCount(summary.total.tokens)
  const other = unit === 'dollars' ? `${formatTokenCount(summary.total.tokens)} tokens` : formatDollars(summary.total.dollars)
  const notes = [
    summary.runningCalls > 0 && `${summary.runningCalls} call${summary.runningCalls > 1 ? 's' : ''} still running, not counted yet`,
    summary.unpricedCalls > 0 && `${summary.unpricedCalls} call${summary.unpricedCalls > 1 ? 's use models' : ' uses a model'} with no price: in tokens only`,
    summary.unsplitCalls > 0 && `${summary.unsplitCalls} call${summary.unsplitCalls > 1 ? 's' : ''} without recorded content: split unavailable`,
    summary.noUsageCalls > 0 && `${summary.noUsageCalls} call${summary.noUsageCalls > 1 ? 's' : ''} reported no token counts`,
  ].filter(Boolean) as string[]
  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[28px] font-semibold tracking-tight">{main}</span>
        <span className="font-mono text-[12px] text-muted">{other}</span>
      </div>
      <div className="text-[12px] text-muted">
        {summary.calls.length} model call{summary.calls.length === 1 ? '' : 's'}
        {unit === 'dollars' && priced < summary.calls.length ? ` · ${priced} priced` : ''}
      </div>
      {notes.map((n) => (
        <p key={n} className="mt-1 text-[11.5px] text-muted">{n}</p>
      ))}
    </section>
  )
}

/** Every segment with its numbers: the table view of the bar. */
function Breakdown({ summary, unit, active, onHover }: { summary: CostSummary; unit: 'dollars' | 'tokens'; active: CostSegmentName | null; onHover: (s: CostSegmentName | null) => void }) {
  const whole = unit === 'dollars' ? summary.total.dollars : summary.total.tokens
  const rows = SEGMENTS.filter((s) => (summary.split[s.id]?.tokens ?? 0) > 0)
  return (
    <table className="mt-3 w-full text-[12px]" onMouseLeave={() => onHover(null)}>
      <tbody>
        {rows.map((s, i) => {
          const amount = summary.split[s.id]!
          const header = i > 0 && s.group !== rows[i - 1].group // a rule between groups
          return (
            <tr
              key={s.id}
              className={`cursor-default ${active === s.id ? 'bg-overlay' : ''} ${header ? 'border-t border-border/70' : ''}`}
              onMouseEnter={() => onHover(s.id)}
            >
              <td className="py-1 pl-1">
                <span className={`cost-${s.group} mr-2 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]`} title={GROUP_LABELS[s.group]} />
                {s.label}
              </td>
              <td className="py-1 text-right font-mono text-muted">{formatTokenCount(amount.tokens)}</td>
              <td className="py-1 text-right font-mono">{formatDollars(amount.dollars)}</td>
              <td className="w-12 py-1 pr-1 text-right font-mono text-muted">{formatPercent(unit === 'dollars' ? amount.dollars : amount.tokens, whole)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] uppercase tracking-wider text-muted">{children}</h3>
}
