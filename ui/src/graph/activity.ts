// Activity in the graph: which cards are active at a moment in time.
//
// With Activity on, the active cards are the ones that open, and the camera
// frames them: every card with a call running at `time` (several when branches
// run in parallel), or else the card of the call that started last, so a card
// stays open through the short gaps between calls. Live is `time = LIVE`, replay
// moves `time`; the same rule serves both.

import type { NormalizedRun, Step } from '../types'

/** The graph keys of the active cards at `time`; empty before anything ran. */
export function activeCardKeys(run: NormalizedRun, time: number): Set<string> {
  const byId = new Map(run.steps.map((s) => [s.id, s]))
  const keyOf = (step: Step) => (step.scope_id ? byId.get(step.scope_id)?.key : undefined)
  const keys = new Set<string>()
  let latest: Step | null = null
  for (const step of run.steps) {
    if (step.hidden || (step.kind !== 'model_call' && step.kind !== 'tool_call')) continue
    if (step.start_ns > time) continue
    if (!latest || step.start_ns >= latest.start_ns) latest = step
    const isRunning = step.end_ns === null || step.end_ns > time
    const key = isRunning ? keyOf(step) : undefined
    if (key) keys.add(key)
  }
  const fallback = keys.size === 0 && latest ? keyOf(latest) : undefined
  if (fallback) keys.add(fallback)
  return keys
}
