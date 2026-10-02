import { describe, expect, it } from 'vitest'
import { LIVE } from '../graph/buildGraph'
import flagshipJson from '../test-data/flagship.json'
import type { NormalizedRun } from '../types'
import { cardsWhereLargest, formatDollars, formatPercent, formatTokenCount, summarizeCost } from './costModel'

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

  it('lists the five most expensive calls', () => {
    const s = summarizeCost(flagship)
    expect(s.top).toHaveLength(5)
    expect(s.top[0].total.dollars).toBe(Math.max(...s.calls.map((c) => c.total.dollars)))
  })

  it('filters to one graph card, including all of its executions', () => {
    const card = 'database_comparison/synthesize'
    const s = summarizeCost(flagship, LIVE, card)
    expect(s.calls.length).toBe(2) // synthesize ran twice
    expect(s.calls.every((c) => c.nodeKey === card)).toBe(true)
    expect(s.total.tokens).toBeLessThan(summarizeCost(flagship).total.tokens)
  })

  it('finds the cards where a segment is largest', () => {
    const s = summarizeCost(flagship)
    const cards = cardsWhereLargest(s, 'cache_read', 'tokens')
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((k) => k.endsWith('/model'))).toBe(true) // only the analysts' model nodes read the cache
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
