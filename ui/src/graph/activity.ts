// Activity in the graph: which card the view follows at a moment in time.
//
// With Activity on, every card shows its calls and the camera follows the card
// where something is happening: a call running at `time`, or else the call that
// started last. Live is `time = LIVE`, replay moves `time`; the same rule serves both.

import type { NormalizedRun, Step } from '../types'

/** The graph key of the card to follow at `time`, or null before anything ran. */
export function activeCardKey(run: NormalizedRun, time: number): string | null {
  const byId = new Map(run.steps.map((s) => [s.id, s]))
  let running: Step | null = null
  let latest: Step | null = null
  for (const step of run.steps) {
    if (step.hidden || (step.kind !== 'model_call' && step.kind !== 'tool_call')) continue
    if (step.start_ns > time) continue
    if (!latest || step.start_ns >= latest.start_ns) latest = step
    const isRunning = step.end_ns === null || step.end_ns > time
    if (isRunning && (!running || step.start_ns >= running.start_ns)) running = step
  }
  const step = running ?? latest
  const scope = step?.scope_id ? byId.get(step.scope_id) : undefined
  return scope?.key ?? null
}
