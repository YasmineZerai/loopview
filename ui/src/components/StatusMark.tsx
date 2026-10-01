import type { StepStatus } from '../types'
import { Check, Cross } from './icons'

/** The state indicator used everywhere: a pulsing dot while running, a check, a cross. */
export function StatusMark({ status, size = 14 }: { status: StepStatus | 'idle'; size?: number }) {
  if (status === 'running') {
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <span className="absolute inset-[3px] animate-ping rounded-full bg-state-running opacity-60" />
        <span className="absolute inset-[4px] rounded-full bg-state-running" />
      </span>
    )
  }
  if (status === 'ok') return <Check size={size} className="shrink-0 text-state-ok" />
  if (status === 'error') return <Cross size={size} className="shrink-0 text-state-error" />
  return <span className="inline-block shrink-0 rounded-full bg-state-idle" style={{ width: 6, height: 6 }} />
}
