// The timeline under the graph: one lane per agent, steps as bars over time.
// Concurrent agents sit in parallel lanes. Hovering a bar highlights its graph
// node and the reverse; clicking or dragging on the track scrubs the replay.

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGraph, LIVE } from '../graph/buildGraph'
import { useSelectedRun, useStore } from '../store'
import { formatDuration, hueMap, NEUTRAL_HUE } from '../theme'
import type { Step } from '../types'

const LABEL_WIDTH = 168
const ROW_HEIGHT = 18
const ROW_GAP = 4
const LANE_PAD = 5

interface Bar {
  step: Step
  row: number
}
interface Lane {
  key: string
  name: string
  hue: string
  bars: Bar[]
  rows: number
  tools: Step[]
}

export function Timeline() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const hoverKey = useStore((s) => s.hoverKey)
  const selectedKey = useStore((s) => s.selectedKey)
  const { setHoverKey, setSelectedKey, setPlayback } = useStore.getState()
  const trackRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [loaded?.run.id])

  const model = useMemo(() => (loaded ? buildLanes(loaded.view) : null), [loaded])
  if (!loaded || !model) return null

  const start = loaded.run.start_ns
  const lastEnd = Math.max(...loaded.view.steps.map((s) => s.end_ns ?? s.start_ns))
  const end = loaded.run.end_ns ?? Math.max(lastEnd, Date.now() * 1e6)
  const span = Math.max(end - start, 1)
  const x = (t: number) => ((t - start) / span) * width
  const now = time === LIVE ? end : time

  const scrubTo = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setPlayback({ time: start + ratio * span, playing: false })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center border-b border-border text-[10.5px] text-muted">
        <div className="pl-4 uppercase tracking-wider" style={{ width: LABEL_WIDTH }}>
          Timeline
        </div>
        <div className="relative h-full flex-1 pr-4">
          {ticks(span).map((t) => (
            <span key={t} className="absolute top-1.5 -translate-x-1/2 font-mono" style={{ left: (t / span) * width }}>
              {t === 0 ? '0s' : formatDuration(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="shrink-0" style={{ width: LABEL_WIDTH }}>
          {model.map((lane) => (
            <div
              key={lane.key}
              className="flex items-center gap-2 truncate border-b border-border/50 pl-4 pr-2 font-mono text-[11.5px]"
              style={{ height: laneHeight(lane) }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: lane.hue }} />
              <span className="truncate text-text/80">{lane.name}</span>
            </div>
          ))}
        </div>
        <div
          ref={trackRef}
          className="relative mr-4 flex-1 cursor-crosshair"
          onMouseDown={(e) => {
            scrubTo(e.clientX)
            const move = (ev: MouseEvent) => scrubTo(ev.clientX)
            const up = () => {
              window.removeEventListener('mousemove', move)
              window.removeEventListener('mouseup', up)
            }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          }}
        >
          {model.map((lane) => (
            <div key={lane.key} className="relative border-b border-border/50" style={{ height: laneHeight(lane) }}>
              {lane.bars.map(({ step, row }) => {
                if (step.start_ns > now) return null
                const stepEnd = Math.min(step.end_ns ?? now, now)
                const running = step.end_ns === null || step.end_ns > now
                const error = !running && step.status === 'error'
                const active = hoverKey === step.key || selectedKey === step.key
                return (
                  <div
                    key={step.id}
                    className={[
                      'timeline-bar absolute flex items-center overflow-hidden rounded-[5px] border px-1.5 font-mono text-[10.5px] transition-[filter] duration-150',
                      running ? 'is-running' : '',
                      active ? 'brightness-150' : '',
                    ].join(' ')}
                    style={{
                      left: x(step.start_ns),
                      width: Math.max(3, x(stepEnd) - x(step.start_ns)),
                      top: LANE_PAD + row * (ROW_HEIGHT + ROW_GAP),
                      height: ROW_HEIGHT,
                      background: error ? 'rgb(248 113 113 / 0.25)' : `color-mix(in srgb, ${lane.hue} 22%, transparent)`,
                      borderColor: error ? 'rgb(248 113 113 / 0.8)' : `color-mix(in srgb, ${lane.hue} 55%, transparent)`,
                      '--hue': lane.hue,
                    } as React.CSSProperties}
                    onMouseEnter={() => setHoverKey(step.key)}
                    onMouseLeave={() => setHoverKey(null)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setSelectedKey(step.key)}
                    title={`${step.name} · ${step.end_ns ? formatDuration(step.end_ns - step.start_ns) : 'running'}`}
                  >
                    <span className="truncate text-text/85">{barLabel(step)}</span>
                  </div>
                )
              })}
              {lane.tools.map((t) =>
                t.start_ns > now ? null : (
                  <span
                    key={t.id}
                    className="absolute bottom-[3px] h-[3px] w-[3px] rounded-full"
                    style={{ left: x(t.start_ns), background: t.status === 'error' ? '#f87171' : lane.hue, opacity: 0.9 }}
                  />
                ),
              )}
            </div>
          ))}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-text/70" style={{ left: x(now) }}>
            <div className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-text" />
          </div>
        </div>
      </div>
    </div>
  )
}

function laneHeight(lane: Lane) {
  return LANE_PAD * 2 + lane.rows * ROW_HEIGHT + (lane.rows - 1) * ROW_GAP + 2
}

/** Lanes: one per agent; bars: its nodes (or its model and tool calls, for a
 * single agent with no nodes). Overlapping bars go on separate rows. */
function buildLanes(run: Parameters<typeof buildGraph>[0]): Lane[] {
  const graph = buildGraph(run)
  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]))
  const hues = hueMap(graph.nodes.map((n) => n.agentKey))
  const byId = new Map(run.steps.map((s) => [s.id, s]))
  const lanes = new Map<string, Lane>()

  const laneFor = (laneKey: string | null): Lane => {
    const key = laneKey ?? '__root__'
    let lane = lanes.get(key)
    if (!lane) {
      const node = laneKey ? nodeByKey.get(laneKey) : undefined
      lane = { key, name: node?.name ?? run.run.name, hue: (laneKey && hues.get(laneKey)) || NEUTRAL_HUE, bars: [], rows: 1, tools: [] }
      lanes.set(key, lane)
    }
    return lane
  }

  const barSteps: Step[] = []
  for (const step of run.steps) {
    if (step.hidden) continue
    const scope = step.scope_id ? byId.get(step.scope_id) : undefined
    if (step.kind === 'node' || step.kind === 'unknown') barSteps.push(step)
    else if ((step.kind === 'model_call' || step.kind === 'tool_call') && scope?.kind === 'agent') barSteps.push(step)
    if (step.kind === 'tool_call' && scope) laneFor(nodeByKey.get(scope.key)?.agentKey ?? null).tools.push(step)
  }
  for (const step of barSteps) {
    const scope = step.scope_id ? byId.get(step.scope_id) : undefined
    const graphKey = step.kind === 'node' || step.kind === 'unknown' ? step.key : scope?.key
    const lane = laneFor((graphKey && nodeByKey.get(graphKey)?.agentKey) ?? null)
    lane.bars.push({ step, row: 0 })
  }
  // Greedy row assignment within each lane.
  for (const lane of lanes.values()) {
    const rowEnds: number[] = []
    lane.bars.sort((a, b) => a.step.start_ns - b.step.start_ns)
    for (const bar of lane.bars) {
      const end = bar.step.end_ns ?? Number.POSITIVE_INFINITY
      let row = rowEnds.findIndex((e) => e <= bar.step.start_ns)
      if (row === -1) row = rowEnds.length
      rowEnds[row] = end
      bar.row = row
    }
    lane.rows = Math.max(1, rowEnds.length)
  }
  // Lanes in order of first activity.
  const first = (l: Lane) => Math.min(...l.bars.map((b) => b.step.start_ns))
  return [...lanes.values()].filter((l) => l.bars.length > 0).sort((a, b) => first(a) - first(b))
}

function barLabel(step: Step): string {
  if (step.kind === 'model_call') {
    const tokens = (step.model?.input_tokens ?? 0) + (step.model?.output_tokens ?? 0)
    return tokens ? `llm · ${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tok` : 'llm'
  }
  return step.name
}

function ticks(span: number): number[] {
  const steps = [1e8, 2e8, 5e8, 1e9, 2e9, 5e9, 1e10, 2e10, 3e10, 6e10, 1.2e11, 3e11]
  const step = steps.find((s) => span / s <= 8) ?? 6e11
  const result = []
  for (let t = 0; t <= span; t += step) result.push(t)
  return result
}
