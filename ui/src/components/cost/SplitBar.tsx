// One horizontal bar for a whole bill, divided by where the tokens came from.
// Segments keep prompt order; colour says the group, a 2px gap separates
// segments, wide segments carry their label, and hovering shows the numbers.

import { useEffect, useRef, useState } from 'react'
import { formatDollars, formatPercent, formatTokenCount, SEGMENTS, type Split } from '../../cost/costModel'
import type { CostSegmentName } from '../../types'

interface Props {
  split: Split
  unit: 'dollars' | 'tokens'
  height?: number
  labels?: boolean // write segment names on wide segments
  active?: CostSegmentName | null // a segment hovered elsewhere (the breakdown table)
  onHover?: (segment: CostSegmentName | null) => void
}

// Approximate width of one character of the 10.5px label, plus padding: a label
// is drawn only when it fits whole, never cut off.
const CHAR_PX = 6.8
const LABEL_PAD_PX = 14

export function SplitBar({ split, unit, height = 28, labels = false, active = null, onHover }: Props) {
  const [hover, setHover] = useState<{ id: CostSegmentName; x: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const parts = SEGMENTS.map((s) => ({ ...s, amount: split[s.id] })).filter((s) => s.amount && s.amount[unit] > 0)
  const total = parts.reduce((sum, p) => sum + p.amount![unit], 0)
  const totals = {
    tokens: parts.reduce((sum, p) => sum + p.amount!.tokens, 0),
    dollars: parts.reduce((sum, p) => sum + p.amount!.dollars, 0),
  }
  if (total <= 0) {
    return <div className="rounded-md bg-overlay" style={{ height }} />
  }
  const hovered = hover ? parts.find((p) => p.id === hover.id) : undefined

  return (
    <div ref={ref} className="relative" onMouseLeave={() => { setHover(null); onHover?.(null) }}>
      <div className="flex gap-[2px] overflow-hidden rounded-md" style={{ height }}>
        {parts.map((p) => {
          const share = p.amount![unit] / total
          const dim = (active ?? hover?.id) && (active ?? hover?.id) !== p.id
          return (
            <div
              key={p.id}
              className={`cost-${p.group} flex min-w-[3px] items-center overflow-hidden px-1.5 transition-opacity duration-150 ${dim ? 'opacity-35' : ''}`}
              style={{ flexGrow: share, flexBasis: 0 }}
              onMouseEnter={(e) => {
                const bar = e.currentTarget.parentElement!.getBoundingClientRect()
                const seg = e.currentTarget.getBoundingClientRect()
                setHover({ id: p.id, x: seg.left - bar.left + seg.width / 2 })
                onHover?.(p.id)
              }}
            >
              {labels && p.label.length * CHAR_PX + LABEL_PAD_PX <= share * width && (
                <span className="whitespace-nowrap text-[10.5px] font-medium leading-none">{p.label}</span>
              )}
            </div>
          )
        })}
      </div>
      {hovered && hover && (
        <div
          className="pointer-events-none absolute top-full z-20 mt-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={{ left: Math.min(Math.max(hover.x, 100), Math.max(width, 200) - 100) }}
        >
          <div className="font-medium">{hovered.label}</div>
          <div className="font-mono text-muted">
            {formatDollars(hovered.amount!.dollars)} · {formatTokenCount(hovered.amount!.tokens)} tok ·{' '}
            {formatPercent(hovered.amount![unit], unit === 'dollars' ? totals.dollars : totals.tokens)}
          </div>
        </div>
      )}
    </div>
  )
}
