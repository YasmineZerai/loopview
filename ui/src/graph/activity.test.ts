import { describe, expect, it } from 'vitest'
import flagshipJson from '../test-data/flagship.json'
import type { NormalizedRun } from '../types'
import { activeCardKey } from './activity'
import { buildGraph, LIVE } from './buildGraph'

const flagship = flagshipJson as unknown as NormalizedRun
const start = flagship.run.start_ns
const end = flagship.run.end_ns!
const cardKeys = new Set(buildGraph(flagship).nodes.map((n) => n.key))
const calls = flagship.steps.filter((s) => !s.hidden && (s.kind === 'model_call' || s.kind === 'tool_call'))

describe('activeCardKey', () => {
  it('is nothing before the first call', () => {
    expect(activeCardKey(flagship, start - 1)).toBeNull()
  })

  it('is always a card of the graph', () => {
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
      const key = activeCardKey(flagship, start + (end - start) * f)
      expect(key).not.toBeNull()
      expect(cardKeys.has(key!)).toBe(true)
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
    expect(activeCardKey(flagship, middle(call!))).toBe(scope.key)
  })

  it('live, ends on the card of the last call', () => {
    const last = [...calls].sort((a, b) => a.start_ns - b.start_ns).at(-1)!
    const scope = flagship.steps.find((s) => s.id === last.scope_id)!
    expect(activeCardKey(flagship, LIVE)).toBe(scope.key)
    expect(activeCardKey(flagship, end)).toBe(scope.key)
  })
})
