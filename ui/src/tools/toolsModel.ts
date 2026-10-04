// The Tools tab's logic, kept out of the component so it can be tested: sorting
// the table, the "after an error" bar, the one-line summary and which state to
// show. The numbers themselves come from the server (loopview/tools/report.py).

import type { AfterError, ToolStats, ToolsReport } from '../types'

export type SortKey = 'name' | 'calls' | 'errors' | 'error_rate' | 'avg_result_tokens_estimate'
export type SortDir = 'asc' | 'desc'

export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'errors', dir: 'desc' }

/** Sorted by one column. Missing values (no result recorded) always go last;
 * ties fall back to the name, so the order never jumps. */
export function sortTools(tools: ToolStats[], key: SortKey, dir: SortDir): ToolStats[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...tools].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name)
    const x = a[key]
    const y = b[key]
    if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1
    return sign * (x - y) || a.name.localeCompare(b.name)
  })
}

/** A column clicked: the same column flips direction, a new one starts with the
 * direction that puts the interesting rows first (text A to Z, numbers high first). */
export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'name' ? 'asc' : 'desc' }
}

export const MOVES = [
  { id: 'blind_retry', label: 'Blind retry', hint: 'the same tool again, with the same arguments' },
  { id: 'fixed', label: 'Fixed arguments', hint: 'the same tool, with different arguments' },
  { id: 'switched', label: 'Switched tool', hint: 'a different tool' },
  { id: 'gave_up', label: 'Gave up', hint: 'no further tool call by that agent in the run' },
] as const

export type MoveId = (typeof MOVES)[number]['id']

export interface BarSegment {
  id: MoveId
  label: string
  count: number
  share: number // 0..1 of all errors of the tool
}

/** The stacked bar's segments, in a fixed order, leaving out empty ones. */
export function afterErrorBar(after: AfterError): BarSegment[] {
  const total = MOVES.reduce((sum, m) => sum + after[m.id], 0)
  if (total === 0) return []
  return MOVES.filter((m) => after[m.id] > 0).map((m) => ({ id: m.id, label: m.label, count: after[m.id], share: after[m.id] / total }))
}

/** "3 blind retries, 1 fixed (1 worked)": the bar in words, for its tooltip. */
export function describeAfterError(after: AfterError): string {
  return afterErrorBar(after)
    .map((s) => (s.id === 'fixed' ? `${s.count} ${s.label.toLowerCase()} (${after.fixed_succeeded} worked)` : `${s.count} ${s.label.toLowerCase()}`))
    .join(', ')
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`

/** Rounded the way people say it: 9,000 rather than 8,947. */
export function roughly(n: number): string {
  if (n < 100) return String(n)
  const step = n < 1000 ? 10 : n < 10_000 ? 100 : 1000
  return (Math.round(n / step) * step).toLocaleString('en-US')
}

/** One plain sentence about the whole report. */
export function summarySentence(report: ToolsReport): string {
  const s = report.summary
  const parts = [`${plural(s.runs, 'run')}, ${plural(s.tool_calls, 'tool call')}, ${plural(s.errors, 'error')}.`]
  const failing = report.tools.filter((t) => t.errors > 0).length
  if (failing === 1) parts.push('1 tool caused every error.')
  else if (failing === 2) parts.push('2 tools caused every error.')
  else if (failing > 2 && s.share_of_errors_from_top_2_tools !== null)
    parts.push(`2 tools caused ${Math.round(s.share_of_errors_from_top_2_tools * 100)}% of errors.`)
  if (!report.tool_list_recorded) parts.push('The tool list offered to the model is not recorded.')
  else if (s.never_called_count === 0) parts.push('Every offered tool was used.')
  else
    parts.push(
      `${plural(s.never_called_count, 'tool')} never used (about ${roughly(s.never_called_tokens_per_run_estimate)} tokens per run, estimated).`,
    )
  return parts.join(' ')
}

export type ViewState = 'loading' | 'failed' | 'no-runs' | 'no-calls' | 'ready'

export function viewState(report: ToolsReport | null, failed: boolean): ViewState {
  if (failed) return 'failed'
  if (!report) return 'loading'
  if (report.summary.runs === 0) return 'no-runs'
  if (report.summary.tool_calls === 0) return 'no-calls'
  return 'ready'
}

export const formatRate = (rate: number) => (rate === 0 ? '0%' : rate < 0.01 ? '<1%' : `${Math.round(rate * 100)}%`)
