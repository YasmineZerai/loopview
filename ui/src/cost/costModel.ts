// The Cost view's numbers, for a moment in time.
//
// The server attaches a cost split to every finished model call (see
// server/src/loopview/cost/split.py): tokens and dollars per segment, adding up
// to the reported usage. This file only sums those splits, the same way the
// graph is built: for a moment `t` (live: everything; replay: what had finished
// by then). So the view grows live and rewinds with the scrubber, and live and
// replay can't disagree.

import { buildGraph, LIVE } from '../graph/buildGraph'
import type { CostSegmentName, NormalizedRun, Step } from '../types'

// Segments are drawn in prompt order, grouped. Each has its own colour, in one
// family of hues per group (theme tokens --color-seg-*).
export type CostGroup = 'instructions' | 'conversation' | 'cache' | 'output' | 'unattributed'

export const SEGMENTS: { id: CostSegmentName; label: string; group: CostGroup }[] = [
  { id: 'tool_prompt', label: 'Tool prompt (provider)', group: 'instructions' },
  { id: 'tool_definitions', label: 'Tool definitions', group: 'instructions' },
  { id: 'system', label: 'System prompt', group: 'instructions' },
  { id: 'history', label: 'History', group: 'conversation' },
  { id: 'tool_results', label: 'Tool results', group: 'conversation' },
  { id: 'new_input', label: 'New input', group: 'conversation' },
  { id: 'cache_read', label: 'Cache reads', group: 'cache' },
  { id: 'cache_write', label: 'Cache writes', group: 'cache' },
  { id: 'thinking', label: 'Thinking', group: 'output' },
  { id: 'reply', label: 'Reply', group: 'output' },
  { id: 'unattributed', label: 'Unattributed', group: 'unattributed' },
]

export const GROUP_LABELS: Record<CostGroup, string> = {
  instructions: 'Instructions',
  conversation: 'Conversation',
  cache: 'Cache',
  output: 'Output',
  unattributed: 'Unattributed',
}

export interface Amount {
  tokens: number
  dollars: number // over priced calls only
}

export type Split = Partial<Record<CostSegmentName, Amount>>

export interface CallRow {
  step: Step
  nodeKey: string | null // the graph card it belongs to
  agentKey: string | null
  total: Amount
  split: Split
  priced: boolean
  status: 'estimated' | 'content_not_recorded' | 'no_usage'
}

export interface AgentRow {
  agentKey: string | null
  name: string
  total: Amount
  split: Split
}

export interface CostSummary {
  total: Amount
  split: Split
  calls: CallRow[] // every finished model call counted, oldest first
  byAgent: AgentRow[] // most expensive first
  unpricedCalls: number // counted in tokens, not in dollars
  unsplitCalls: number // usage reported, content not recorded
  noUsageCalls: number
  runningCalls: number // started but not finished at this moment
}

const empty = (): Amount => ({ tokens: 0, dollars: 0 })

function add(split: Split, name: CostSegmentName, tokens: number, dollars: number | null | undefined) {
  const amount = (split[name] ??= empty())
  amount.tokens += tokens
  amount.dollars += dollars ?? 0
}

/**
 * Sum the cost of every model call finished by `time`. With `nodeKey`, only the
 * calls made inside that graph card (all its executions, when it ran in a loop).
 */
export function summarizeCost(run: NormalizedRun, time: number = LIVE, nodeKey: string | null = null): CostSummary {
  const byId = new Map(run.steps.map((s) => [s.id, s]))
  const graph = buildGraph(run)
  const agentOf = new Map(graph.nodes.map((n) => [n.key, n.agentKey]))
  const nameOf = new Map(graph.nodes.map((n) => [n.key, n.name]))

  const summary: CostSummary = {
    total: empty(), split: {}, calls: [], byAgent: [],
    unpricedCalls: 0, unsplitCalls: 0, noUsageCalls: 0, runningCalls: 0,
  }
  const agents = new Map<string | null, AgentRow>()

  const modelCalls = run.steps
    .filter((s) => s.kind === 'model_call' && !s.hidden && s.start_ns <= time)
    .sort((a, b) => a.start_ns - b.start_ns)
  for (const step of modelCalls) {
    const scopeKey = step.scope_id ? (byId.get(step.scope_id)?.key ?? null) : null
    if (nodeKey !== null && scopeKey !== nodeKey) continue
    // A call's cost is known when it ends.
    if (step.end_ns === null || step.end_ns > time) {
      summary.runningCalls += 1
      continue
    }
    const cost = step.model?.cost
    if (!cost || cost.status === 'no_usage') {
      summary.noUsageCalls += 1
      continue
    }
    const priced = cost.dollars !== null && cost.dollars !== undefined
    if (!priced) summary.unpricedCalls += 1
    if (cost.status === 'content_not_recorded') summary.unsplitCalls += 1

    const row: CallRow = {
      step, nodeKey: scopeKey, agentKey: scopeKey ? (agentOf.get(scopeKey) ?? null) : null,
      total: empty(), split: {}, priced, status: cost.status,
    }
    const agentKey = row.agentKey
    const agent = agents.get(agentKey) ?? { agentKey, name: agentKey ? (nameOf.get(agentKey) ?? agentKey) : run.run.name, total: empty(), split: {} }
    agents.set(agentKey, agent)

    for (const seg of cost.segments) {
      for (const target of [row, agent, summary]) {
        add(target.split, seg.name, seg.tokens, seg.dollars)
        target.total.tokens += seg.tokens
        target.total.dollars += seg.dollars ?? 0
      }
    }
    summary.calls.push(row)
  }

  summary.byAgent = [...agents.values()].sort((a, b) => b.total.dollars - a.total.dollars || b.total.tokens - a.total.tokens)
  return summary
}

// --- formatting ----------------------------------------------------------------------

// Cents from ten cents up ($0.43, $12.50); below that two significant digits
// ($0.079, $0.0042), since agent runs are often cheap and $0.01 vs $0.01 hides
// a 20% vs 15% difference.
export function formatDollars(value: number): string {
  if (value === 0) return '$0.00'
  if (value >= 0.1) return `$${value.toFixed(2)}`
  return `$${value.toPrecision(2)}`
}

export function formatTokenCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  const pct = (part / whole) * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}
