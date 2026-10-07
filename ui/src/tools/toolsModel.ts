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

/** One headline finding over the whole report, drawn as a card above the table. */
export interface Finding {
  id: 'recovery' | 'unused' | 'heaviest'
  figure: string // the number, big
  title: string // what the number is
  detail: string // why it matters
}

/** What the report says that no single trace would: how the agent copes with
 * errors, what unused tools cost and which results crowd the context. */
export function findings(report: ToolsReport): Finding[] {
  const out: Finding[] = []
  const errors = report.summary.errors
  if (errors > 0) {
    const total = report.tools.reduce(
      (sum, t) => ({
        blind_retry: sum.blind_retry + t.after_error.blind_retry,
        fixed: sum.fixed + t.after_error.fixed,
        fixed_succeeded: sum.fixed_succeeded + t.after_error.fixed_succeeded,
        switched: sum.switched + t.after_error.switched,
        gave_up: sum.gave_up + t.after_error.gave_up,
      }),
      { blind_retry: 0, fixed: 0, fixed_succeeded: 0, switched: 0, gave_up: 0 },
    )
    const changed = total.fixed + total.switched
    const next = [
      total.fixed > 0 && `fixed its arguments ${plural(total.fixed, 'time')} (${total.fixed_succeeded} worked)`,
      total.switched > 0 && `switched tool ${plural(total.switched, 'time')}`,
      total.blind_retry > 0 && `retried blindly ${plural(total.blind_retry, 'time')}`,
      total.gave_up > 0 && `gave up ${plural(total.gave_up, 'time')}`,
    ].filter(Boolean)
    out.push({
      id: 'recovery',
      figure: `${changed} of ${errors}`,
      title: `tool ${errors === 1 ? 'error' : 'errors'} led the agent to change course`,
      detail: next.length ? `After an error, it ${next.join(', ')}.` : 'No tool was called after these errors.',
    })
  }
  const s = report.summary
  if (report.tool_list_recorded && s.never_called_count > 0) {
    const biggest = [...report.never_called].sort((a, b) => b.definition_tokens_estimate - a.definition_tokens_estimate)[0]
    out.push({
      id: 'unused',
      figure: `~${roughly(s.never_called_tokens_estimate)}`,
      title: `tokens spent describing ${plural(s.never_called_count, 'tool')} the model never called`,
      detail:
        `About ${roughly(s.never_called_tokens_per_run_estimate)} per run: their definitions ride along with every model call. ` +
        (biggest ? `The biggest, ${biggest.name}, costs ~${roughly(biggest.definition_tokens_estimate)} on its own.` : ''),
    })
  }
  const heaviest = report.tools
    .filter((t) => t.avg_result_tokens_estimate !== null)
    .sort((a, b) => b.avg_result_tokens_estimate! - a.avg_result_tokens_estimate!)[0]
  if (heaviest) {
    out.push({
      id: 'heaviest',
      figure: `~${roughly(heaviest.avg_result_tokens_estimate!)}`,
      title: `tokens per ${heaviest.name} result, on average`,
      detail: 'The largest tool output. It stays in the context, and is paid for again, on every later model call of the run.',
    })
  }
  return out
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
