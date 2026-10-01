// The activity feed: what the agents think, say and do, in order.
//
// One entry per model call (its thinking, its text, the tools it asked for) and
// per tool call (arguments in, result or error out), labelled with the agent and
// node it belongs to. It follows the same clock as the graph, so in replay the
// feed fills in as time moves, and live it grows as spans arrive.

import { useEffect, useMemo, useRef } from 'react'
import { buildGraph, LIVE, type GraphNode } from '../graph/buildGraph'
import { useSelectedRun, useStore } from '../store'
import { formatDuration, hueMap, NEUTRAL_HUE } from '../theme'
import type { Step } from '../types'
import { CallView, isRunning, orderCalls } from './CallViews'
import { StatusMark } from './StatusMark'

interface Entry {
  step: Step
  node: GraphNode | undefined // the graph node it happened in
  hue: string
}

export function ActivityFeed() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const { setHoverKey, setSelectedKey } = useStore.getState()
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Every model and tool call, in reading order, with its node and colour.
  const all = useMemo<Entry[]>(() => {
    if (!loaded) return []
    const graph = buildGraph(loaded.view)
    const nodes = new Map(graph.nodes.map((n) => [n.key, n]))
    const hues = hueMap(graph.nodes.map((n) => n.agentKey))
    const byId = new Map(loaded.view.steps.map((s) => [s.id, s]))
    return orderCalls(loaded.view.steps).map((step) => {
      const scope = step.scope_id ? byId.get(step.scope_id) : undefined
      const node = scope ? nodes.get(scope.key) : undefined
      return { step, node, hue: (node?.agentKey && hues.get(node.agentKey)) || NEUTRAL_HUE }
    })
  }, [loaded])

  const visible = time === LIVE ? all : all.filter((e) => e.step.start_ns <= time)

  // Follow the newest entry, unless the reader scrolled up to read something.
  useEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  if (!loaded) return null
  const start = loaded.run.start_ns
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-[11px] uppercase tracking-wider text-muted">Activity</span>
        <span className="font-mono text-[11px] text-muted">{visible.length} events</span>
      </div>
      <div
        ref={scroller}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {visible.length === 0 && <p className="px-1 text-[12.5px] text-muted">Nothing yet.</p>}
        {visible.map((entry) => (
          <div
            key={entry.step.id}
            className="fade-in cursor-pointer rounded-lg border border-border bg-surface p-2.5 transition-colors duration-150 hover:border-muted/50"
            style={{ '--hue': entry.hue } as React.CSSProperties}
            onMouseEnter={() => entry.node && setHoverKey(entry.node.key)}
            onMouseLeave={() => setHoverKey(null)}
            onClick={() => entry.node && setSelectedKey(entry.node.key)}
          >
            <EntryHeader entry={entry} start={start} time={time} />
            <CallView step={entry.step} time={time} />
          </div>
        ))}
      </div>
    </div>
  )
}

function EntryHeader({ entry, start, time }: { entry: Entry; start: number; time: number }) {
  const { step, node } = entry
  const group = node?.groupKey ? node.groupKey.split('/').pop() : undefined
  const status = isRunning(step, time) ? 'running' : step.status
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: entry.hue }} />
      <span className="hue-ink truncate font-mono font-medium">
        {group && group !== node?.name ? `${group} › ` : ''}
        {node?.name ?? 'run'}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-muted">
        +{formatDuration(step.start_ns - start)}
        <StatusMark status={status} size={11} />
      </span>
    </div>
  )
}
