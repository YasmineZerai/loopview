import { describe, expect, it } from 'vitest'
import flagshipJson from '../test-data/flagship.json'
import type { NormalizedRun } from '../types'
import { activeCardKeys } from './activity'
import { buildGraph, LIVE } from './buildGraph'

const flagship = flagshipJson as unknown as NormalizedRun
const start = flagship.run.start_ns
const end = flagship.run.end_ns!
const cardKeys = new Set(buildGraph(flagship).nodes.map((n) => n.key))
const calls = flagship.steps.filter((s) => !s.hidden && (s.kind === 'model_call' || s.kind === 'tool_call'))

describe('activeCardKeys', () => {
  it('is nothing before the first call', () => {
    expect(activeCardKeys(flagship, start - 1).size).toBe(0)
  })

  it('is always a card of the graph', () => {
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
      const keys = activeCardKeys(flagship, start + (end - start) * f)
      expect(keys.size).toBeGreaterThan(0)
      for (const key of keys) expect(cardKeys.has(key)).toBe(true)
    }
  })

  it('follows a call that is running at that moment', () => {
    // A long call with nothing else starting during its first half.
    const middle = (c: (typeof calls)[number]) => (c.start_ns + c.end_ns!) / 2
    const call = calls.find(
      (c) => c.end_ns! - c.start_ns > 1e9 && !calls.some((o) => o !== c && o.start_ns >= c.start_ns && o.start_ns <= middle(c)),
    )
    expect(call).toBeDefined()
    const scope = flagship.steps.find((s) => s.id === call!.scope_id)!
    expect(activeCardKeys(flagship, middle(call!)).has(scope.key)).toBe(true)
  })

  it('live, ends on the card of the last call', () => {
    const last = [...calls].sort((a, b) => a.start_ns - b.start_ns).at(-1)!
    const scope = flagship.steps.find((s) => s.id === last.scope_id)!
    expect([...activeCardKeys(flagship, LIVE)]).toEqual([scope.key])
    expect([...activeCardKeys(flagship, end)]).toEqual([scope.key])
  })

  it('opens every card that has a call running, when branches run in parallel', () => {
    // A moment when calls of two different cards overlap: the parallel analysts.
    const scopeOf = (c: (typeof calls)[number]) => flagship.steps.find((s) => s.id === c.scope_id)!.key
    const overlap = calls.flatMap((a) =>
      calls.filter((b) => scopeOf(a) !== scopeOf(b) && b.start_ns > a.start_ns && b.start_ns < a.end_ns!).map((b) => [a, b] as const),
    )[0]
    expect(overlap).toBeDefined()
    const [a, b] = overlap
    const keys = activeCardKeys(flagship, b.start_ns + 1)
    expect(keys.has(scopeOf(a))).toBe(true)
    expect(keys.has(scopeOf(b))).toBe(true)
  })

  it('closes a card once its calls are done and another one runs', () => {
    const sorted = [...calls].sort((a, b) => a.start_ns - b.start_ns)
    const first = sorted[0]
    const later = sorted.find((c) => c.start_ns > first.end_ns! && c.scope_id !== first.scope_id && !sorted.some((o) => o.scope_id === first.scope_id && o.start_ns <= c.start_ns + 1 && o.end_ns! > c.start_ns + 1))!
    const firstKey = flagship.steps.find((s) => s.id === first.scope_id)!.key
    expect(activeCardKeys(flagship, first.start_ns + 1).has(firstKey)).toBe(true)
    expect(activeCardKeys(flagship, later.start_ns + 1).has(firstKey)).toBe(false)
  })
})
