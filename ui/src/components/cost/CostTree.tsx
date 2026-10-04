// The cost view: the run drawn as a tree whose branches are as thick as the
// money that flows through them. The trunk is the whole run; it splits into
// agents (in their colours), then steps. Click a step to see what its tokens
// were spent on. Totals are reported by the provider, the split is estimated
// from recorded content (DECISIONS D38 to D41); this view only sums and draws.

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDollars, formatPercent, formatTokenCount, GROUP_LABELS, SEGMENTS, summarizeCost, type CostGroup } from '../../cost/costModel'
import { ancestry, BAR_WIDTH, buildCostTree, flatten, layoutTree, type CostNode, type Placed } from '../../cost/costTree'
import { buildGraph } from '../../graph/buildGraph'
import { useSelectedRun, useStore } from '../../store'
import { hueMap, NEUTRAL_HUE } from '../../theme'

const segColour = (id: string) => `var(--color-seg-${id})`

export function CostTree() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const unit = useStore((s) => s.costUnit)
  const selectedKey = useStore((s) => s.selectedKey)
  const { setCostUnit, setView, setSelectedKey, focusCard } = useStore.getState()

  const graph = useMemo(() => (loaded ? buildGraph(loaded.view) : null), [loaded])
  const hues = useMemo(() => hueMap(graph ? graph.nodes.map((n) => n.agentKey) : []), [graph])
  const summary = useMemo(() => (loaded ? summarizeCost(loaded.view, time) : null), [loaded, time])
  const root = useMemo(() => {
    if (!summary || !graph) return null
    const names = new Map(graph.nodes.map((n) => [n.key, n.name]))
    return buildCostTree(summary, (key) => names.get(key) ?? key, unit)
  }, [summary, graph, unit])

  // Steps showing their segments. Starts with the most expensive one open, so
  // the leaves are visible without a click; a card selected in the graph opens too.
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const steps = useMemo(() => (root ? flatten(root).filter((n) => n.level === 'step') : []), [root])
  const open = useMemo(() => {
    if (expanded) return expanded
    const top = [...steps].sort((a, b) => b.amount[unit] - a.amount[unit])[0]
    return new Set(top ? [top.id] : [])
  }, [expanded, steps, unit])
  // Only when the selection changes, so the current steps are read through a ref.
  const stepsRef = useRef(steps)
  useEffect(() => {
    stepsRef.current = steps
  }, [steps])
  useEffect(() => {
    const step = stepsRef.current.find((s) => s.cardKey === selectedKey)
    if (step) setExpanded((prev) => new Set([...(prev ?? []), step.id]))
  }, [selectedKey])
  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }
  const allOpen = steps.length > 0 && steps.every((s) => open.has(s.id))

  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const width = useWidth(box)
  const layout = useMemo(
    () => (root && width > 0 ? layoutTree(root, { width, unit, expanded: open, trunk: Math.min(320, Math.max(200, width * 0.22)) }) : null),
    [root, width, unit, open],
  )

  const [hoverId, setHoverId] = useState<string | null>(null)
  const hovered = layout?.nodes.find((p) => p.node.id === hoverId)?.node ?? null
  // While hovering, the hovered node's line (ancestors and descendants) stays lit.
  const lit = (n: CostNode) => !hovered || ancestry(hovered).includes(n) || ancestry(n).includes(hovered)

  if (!loaded || !summary || !root) return null
  const hueOf = (n: CostNode) => (n.agentKey && hues.get(n.agentKey)) || NEUTRAL_HUE
  const value = (n: CostNode) => (unit === 'dollars' ? formatDollars(n.amount.dollars) : `${formatTokenCount(n.amount.tokens)} tok`)
  const notes = [
    summary.runningCalls > 0 && `${summary.runningCalls} call${summary.runningCalls > 1 ? 's' : ''} running, not counted yet`,
    summary.unpricedCalls > 0 && `${summary.unpricedCalls} with no price (tokens only)`,
    summary.unsplitCalls > 0 && `${summary.unsplitCalls} without recorded content`,
    summary.noUsageCalls > 0 && `${summary.noUsageCalls} without token counts`,
  ].filter(Boolean) as string[]

  const onClick = (n: CostNode) => {
    if (n.level === 'step') toggle(n.id)
    else if (n.level === 'segment' && n.parent) toggle(n.parent.id)
  }
  const showInGraph = (n: CostNode) => {
    if (!n.cardKey) return
    setView('graph')
    setSelectedKey(n.cardKey)
    focusCard(n.cardKey)
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas" style={{ '--tab': 'var(--color-view-cost)' } as React.CSSProperties}>
      <header className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-1 px-6 pt-5 pb-2">
        <div>
          <div className="view-ink text-[11px] font-medium uppercase tracking-wider">Where the money goes</div>
          <div className="flex items-baseline gap-3">
            <span className="view-ink font-mono text-[30px] font-semibold tracking-tight">{unit === 'dollars' ? formatDollars(root.amount.dollars) : formatTokenCount(root.amount.tokens)}</span>
            <span className="font-mono text-[12px] text-muted">
              {unit === 'dollars' ? `${formatTokenCount(root.amount.tokens)} tokens` : formatDollars(root.amount.dollars)} · {summary.calls.length} model calls
            </span>
          </div>
        </div>
        {notes.length > 0 && <span className="pb-1.5 text-[11.5px] text-muted">{notes.join(' · ')}</span>}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <button
            className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-overlay hover:text-text"
            onClick={() => setExpanded(allOpen ? new Set() : new Set(steps.map((s) => s.id)))}
          >
            {allOpen ? 'Fold all steps' : 'Open all steps'}
          </button>
          <div className="flex rounded-md border border-border bg-surface p-0.5 text-[11px]">
            {(['dollars', 'tokens'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setCostUnit(u)}
                className={`rounded px-2 py-0.5 font-mono ${unit === u ? 'bg-overlay-strong text-text' : 'text-muted hover:text-text'}`}
              >
                {u === 'dollars' ? '$' : 'tokens'}
              </button>
            ))}
          </div>
        </div>
        {/* Fixed height, so hovering doesn't move the tree. */}
        <div className="flex min-h-[44px] w-full flex-wrap content-start items-center gap-x-5 gap-y-1 pt-3 text-[11.5px] text-muted">
          {hovered ? (
            <HoverLine n={hovered} root={root} unit={unit} />
          ) : (
            <>
              <Legend />
              <span className="w-full">Thickness is cost. Click a step to open it, double-click to show it in the graph.</span>
            </>
          )}
        </div>
      </header>

      <div ref={setBox} className="relative min-h-0 flex-1 overflow-auto pb-24" onMouseLeave={() => setHoverId(null)}>
        {root.children.length === 0 ? (
          <p className="pt-16 text-center text-[13px] text-muted">No finished model calls with reported usage yet.</p>
        ) : (
          layout && (
            <svg width={layout.width} height={layout.height} className="block">
              <defs>
                <pattern id="seg-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--color-canvas)" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke="var(--color-seg-unattributed)" strokeWidth="2.5" />
                </pattern>
              </defs>

              {layout.branches.map((b) => {
                const n = b.to.node
                const colour = n.level === 'segment' ? segFill(n.segment!) : hueOf(n)
                return (
                  <path
                    key={b.id}
                    d={b.path}
                    fill={colour}
                    className="cost-branch"
                    style={{ opacity: lit(n) ? (n.level === 'segment' ? 0.42 : 0.3) : 0.07 }}
                  />
                )
              })}

              {layout.nodes.map((p) => (
                <Bar key={p.node.id} p={p} hue={hueOf(p.node)} dim={!lit(p.node)} />
              ))}

              {layout.nodes.map((p) => (
                <g
                  key={`hit-${p.node.id}`}
                  className={p.node.level === 'step' || p.node.level === 'segment' ? 'cursor-pointer' : ''}
                  onMouseEnter={() => setHoverId(p.node.id)}
                  onClick={() => onClick(p.node)}
                  onDoubleClick={() => showInGraph(p.node)}
                >
                  <rect x={p.x - 6} y={p.y + p.h / 2 - 20} width={BAR_WIDTH + 12 + 170} height={40} fill="transparent" />
                  <Label p={p} hue={hueOf(p.node)} value={value(p.node)} share={formatPercent(p.node.amount[unit], root.amount[unit])} dim={!lit(p.node)} open={open.has(p.node.id)} />
                </g>
              ))}
            </svg>
          )
        )}
      </div>

    </div>
  )
}

const segFill = (id: string) => (id === 'unattributed' ? 'url(#seg-hatch)' : segColour(id))

/** A node's bar. The trunk and the steps are stacked by what they were spent on. */
function Bar({ p, hue, dim }: { p: Placed; hue: string; dim: boolean }) {
  const { node } = p
  const style = { opacity: dim ? 0.25 : 1 }
  if (node.level === 'agent') {
    return <rect className="cost-bar" x={p.x} y={p.y} width={BAR_WIDTH} height={p.h} rx={3} fill={hue} style={style} />
  }
  if (node.level === 'segment') {
    return <rect className="cost-bar" x={p.x} y={p.y} width={BAR_WIDTH} height={p.h} rx={3} fill={segFill(node.segment!)} style={style} />
  }
  // Run and steps: a stack of segment colours, in prompt order.
  // Stacked by tokens, so the colours read the same in $ and tokens.
  const parts = SEGMENTS.filter((seg) => node.split[seg.id])
  const total = parts.reduce((s, seg) => s + node.split[seg.id]!.tokens, 0) || 1
  const tops = parts.map((_, i) => p.y + (parts.slice(0, i).reduce((s, seg) => s + node.split[seg.id]!.tokens, 0) / total) * p.h)
  const clip = `clip-${node.id.replace(/[^\w-]/g, '_')}`
  return (
    <g style={style} className="cost-bar">
      <clipPath id={clip}>
        <rect x={p.x} y={p.y} width={BAR_WIDTH} height={p.h} rx={3} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {parts.map((seg, i) => (
          <rect key={seg.id} x={p.x} y={tops[i]} width={BAR_WIDTH} height={(node.split[seg.id]!.tokens / total) * p.h} fill={segFill(seg.id)} />
        ))}
      </g>
      {node.level === 'step' && <rect x={p.x - 3} y={p.y} width={2} height={p.h} rx={1} fill={hue} />}
    </g>
  )
}

function Label({ p, hue, value, share, dim, open }: { p: Placed; hue: string; value: string; share: string; dim: boolean; open: boolean }) {
  const { node } = p
  const x = p.x + BAR_WIDTH + 8
  const cy = p.y + p.h / 2
  const nameColour = node.level === 'agent' ? `color-mix(in srgb, ${hue}, var(--hue-ink-mix))` : 'var(--color-text)'
  const marker = node.level === 'step' && node.children.length > 0 ? (open ? '▾ ' : '▸ ') : ''
  return (
    <g className="cost-label" style={{ opacity: dim ? 0.3 : 1 }}>
      <text x={x} y={cy - 3} fontSize={node.level === 'run' ? 14 : 12.5} fontWeight={node.level === 'segment' ? 400 : 600} fill={nameColour}>
        {marker}
        {node.name}
      </text>
      <text x={x} y={cy + 12} fontSize={11} className="font-mono" fill="var(--color-muted)">
        {value} · {share}
      </text>
    </g>
  )
}

function HoverLine({ n, root, unit }: { n: CostNode; root: CostNode; unit: 'dollars' | 'tokens' }) {
  const path = ancestry(n).slice(1).map((a) => a.name).join(' › ') || 'whole run'
  return (
    <span className="h-[18px] truncate font-mono">
      <span className="text-text">{path}</span>
      {'   '}
      {formatDollars(n.amount.dollars)} · {formatTokenCount(n.amount.tokens)} tokens · {formatPercent(n.amount[unit], root.amount[unit])} of the run
      {n.parent && n.parent !== root ? ` · ${formatPercent(n.amount[unit], n.parent.amount[unit])} of ${n.parent.name}` : ''}
    </span>
  )
}

function Legend() {
  const groups: CostGroup[] = ['instructions', 'conversation', 'cache', 'output', 'unattributed']
  return (
    <>
      {groups.map((g) => (
        <span key={g} className="flex h-[18px] items-center gap-1.5">
          <span className="mr-0.5 text-text">{GROUP_LABELS[g]}</span>
          {SEGMENTS.filter((s) => s.group === g).map((s) => (
            <span key={s.id} className="flex items-center gap-1">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.id === 'unattributed' ? 'cost-unattributed' : ''}`} style={s.id === 'unattributed' ? undefined : { background: segColour(s.id) }} />
              {g === 'unattributed' ? null : s.label.replace(' (provider)', '')}
            </span>
          ))}
        </span>
      ))}
    </>
  )
}

function useWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return width
}
