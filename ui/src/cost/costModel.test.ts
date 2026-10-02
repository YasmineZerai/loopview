import { describe, expect, it } from 'vitest'
import { LIVE } from '../graph/buildGraph'
import flagshipJson from '../test-data/flagship.json'
import type { NormalizedRun } from '../types'
import { formatDollars, formatPercent, formatTokenCount, summarizeCost } from './costModel'
import { ancestry, buildCostTree, flatten, layoutTree } from './costTree'

const flagship = flagshipJson as unknown as NormalizedRun
const end = flagship.run.end_ns!
const start = flagship.run.start_ns

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const splitTokens = (split: ReturnType<typeof summarizeCost>['split']) => sum(Object.values(split).map((a) => a!.tokens))

describe('summarizeCost', () => {
  it('adds up every call: the split equals the total, and the total equals the reported usage', () => {
    const s = summarizeCost(flagship)
    const reported = sum(
      flagship.steps
        .filter((st) => st.kind === 'model_call' && !st.hidden)
        .map((st) => (st.model?.usage?.input_tokens ?? 0) + (st.model?.usage?.output_tokens ?? 0)),
    )
    expect(s.total.tokens).toBe(reported)
    expect(splitTokens(s.split)).toBe(s.total.tokens)
    expect(s.total.dollars).toBeGreaterThan(0)
    expect(s.unpricedCalls).toBe(0)
    expect(s.split.cache_read?.tokens).toBeGreaterThan(0)
  })

  it('live and the end of the replay agree', () => {
    expect(summarizeCost(flagship, end)).toEqual(summarizeCost(flagship, LIVE))
  })

  it('counts only calls finished at the moment, and grows over time', () => {
    const atStart = summarizeCost(flagship, start)
    expect(atStart.total.tokens).toBe(0)
    let previous = 0
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const t = start + (end - start) * f
      const s = summarizeCost(flagship, t)
      expect(s.total.tokens).toBeGreaterThanOrEqual(previous)
      previous = s.total.tokens
      for (const call of s.calls) expect(call.step.end_ns!).toBeLessThanOrEqual(t)
    }
    const mid = summarizeCost(flagship, start + (end - start) * 0.3)
    expect(mid.runningCalls).toBeGreaterThan(0)
  })

  it('splits by agent and the agents add up to the run', () => {
    const s = summarizeCost(flagship)
    expect(s.byAgent.map((a) => a.name)).toEqual(expect.arrayContaining(['benchmarks_analyst', 'ecosystem_analyst', 'writer']))
    expect(sum(s.byAgent.map((a) => a.total.tokens))).toBe(s.total.tokens)
    const dollars = s.byAgent.map((a) => a.total.dollars)
    expect([...dollars].sort((a, b) => b - a)).toEqual(dollars) // most expensive first
  })

  it('filters to one graph card, including all of its executions', () => {
    const card = 'database_comparison/synthesize'
    const s = summarizeCost(flagship, LIVE, card)
    expect(s.calls.length).toBe(2) // synthesize ran twice
    expect(s.calls.every((c) => c.nodeKey === card)).toBe(true)
    expect(s.total.tokens).toBeLessThan(summarizeCost(flagship).total.tokens)
  })

})

describe('cost tree', () => {
  const name = (key: string) => key.split('/').pop()!
  const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6)
  const tree = (unit: 'dollars' | 'tokens' = 'dollars', time = LIVE) => buildCostTree(summarizeCost(flagship, time), name, unit)

  it('nests run, agents, steps and segments, and each level adds up to its parent', () => {
    for (const unit of ['dollars', 'tokens'] as const) {
      const root = tree(unit)
      expect(root.children.every((a) => a.level === 'agent')).toBe(true)
      for (const n of flatten(root)) {
        if (n.children.length > 0) close(n.children.reduce((s, c) => s + c.amount[unit], 0), n.amount[unit])
      }
      const agents = root.children.map((a) => a.amount[unit])
      expect([...agents].sort((a, b) => b - a)).toEqual(agents) // largest first
    }
  })

  it('knows each node\'s graph card and path', () => {
    const leaf = flatten(tree('tokens')).find((n) => n.level === 'segment' && n.cardKey?.endsWith('/synthesize'))!
    expect(leaf.cardKey).toBe('database_comparison/synthesize')
    expect(ancestry(leaf).map((n) => n.level)).toEqual(['run', 'agent', 'step', 'segment'])
    expect(leaf.parent!.name).toBe('synthesize ×2') // ran twice
  })

  it('grows with the replay clock', () => {
    expect(flatten(tree('tokens', start + (end - start) * 0.3)).length).toBeLessThan(flatten(tree('tokens')).length)
  })

  it('lays out bars as tall as their cost, and branches that add up to each bar', () => {
    const root = tree()
    const layout = layoutTree(root, { width: 1200, unit: 'dollars', expanded: new Set(), trunk: 300 })
    const run = layout.nodes.find((p) => p.node.level === 'run')!
    close(run.h, 300)
    // Collapsed: three columns, no segments drawn.
    expect(new Set(layout.nodes.map((p) => p.depth))).toEqual(new Set([0, 1, 2]))
    const fromRun = layout.branches.filter((b) => b.from === run)
    close(fromRun.reduce((s, b) => s + b.to.h, 0), run.h)
    // Branches leave the bar stacked, top to bottom, without gaps.
    fromRun.forEach((b, i) => close(b.y0, i === 0 ? run.y : fromRun[i - 1].y0 + fromRun[i - 1].to.h))
  })

  it('shows a step\'s segments when it is expanded, without overlapping leaves', () => {
    const root = tree()
    const step = flatten(root).find((n) => n.level === 'step')!
    const layout = layoutTree(root, { width: 1200, unit: 'dollars', expanded: new Set([step.id]) })
    const leaves = layout.nodes.filter((p) => p.node.parent?.id === step.id)
    expect(leaves.length).toBe(step.children.length)
    expect(leaves.every((p) => p.depth === 3)).toBe(true)
    const column = layout.nodes.filter((p) => p.depth === 2 || p.depth === 3).sort((a, b) => a.y - b.y)
    for (let i = 1; i < column.length; i++) {
      if (column[i].depth === column[i - 1].depth) expect(column[i].y).toBeGreaterThanOrEqual(column[i - 1].y + column[i - 1].h)
    }
  })
})

describe('formatting', () => {
  it('formats money, tokens and percentages', () => {
    expect(formatDollars(0.4321)).toBe('$0.43')
    expect(formatDollars(12.5)).toBe('$12.50')
    expect(formatDollars(0.0042)).toBe('$0.0042')
    expect(formatDollars(0.0789)).toBe('$0.079')
    expect(formatDollars(0)).toBe('$0.00')
    expect(formatTokenCount(69900)).toBe('69,900')
    expect(formatPercent(1, 400)).toBe('<1%')
    expect(formatPercent(1, 4)).toBe('25%')
  })
})
