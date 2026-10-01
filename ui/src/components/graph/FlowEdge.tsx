// An edge between graph nodes, routed by ELK. When control travels along it
// (its count goes up, live or during replay), a particle runs from source to target.

import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import { memo, useEffect, useRef, useState } from 'react'
import type { GraphEdge } from '../../graph/buildGraph'
import { roundedPath } from '../../graph/layout'

export type FlowEdgeData = {
  edge: GraphEdge
  route: { x: number; y: number }[] | undefined
  hue: string
  active: boolean // its target is running right now
}

export type FlowFlowEdge = Edge<FlowEdgeData, 'flow'>

const PARTICLE_MS = 450

function FlowEdgeView({ id, data, sourceX, sourceY, targetX, targetY, markerEnd }: EdgeProps<FlowFlowEdge>) {
  const edge = data!.edge
  const loop = edge.kind === 'loop'
  const points = data!.route ?? [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ]
  const arc = loop ? loopArc(sourceX, sourceY, targetX, targetY) : null
  const path = arc ? arc.path : roundedPath(points)
  const particles = useParticles(edge.count)
  const label = arc ? arc.top : pointAtHalfLength(points)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={['flow-edge', loop ? 'is-loop' : '', data!.active ? 'is-active' : ''].join(' ')}
        style={{ '--hue': data!.hue } as React.CSSProperties}
      />
      {edge.count > 1 && (
        <g transform={`translate(${label.x}, ${label.y})`} className="pointer-events-none">
          <rect x={-13} y={-9} width={26} height={18} rx={9} className="fill-canvas stroke-border" />
          <text textAnchor="middle" dy={4} className="fill-muted font-mono text-[10px]">
            ×{edge.count}
          </text>
        </g>
      )}
      {particles.map((p) => (
        <circle key={p} r={4} className="flow-particle" style={{ fill: data!.hue, color: data!.hue }}>
          <animateMotion dur={`${PARTICLE_MS}ms`} path={path} fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" keyPoints="0;1" />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.8;1" dur={`${PARTICLE_MS}ms`} fill="freeze" />
        </circle>
      ))}
    </>
  )
}

/** A loop goes back to an earlier node: an arc from the source's right side,
 * up over the nodes, down into the target's left side. */
function loopArc(sx: number, sy: number, tx: number, ty: number) {
  const lift = 34 + Math.abs(sx - tx) * 0.1
  const top = Math.min(sy, ty) - lift
  const path = `M ${sx} ${sy} C ${sx + 48} ${sy} ${sx + 48} ${top} ${(sx + tx) / 2} ${top} S ${tx - 48} ${ty} ${tx} ${ty}`
  return { path, top: { x: (sx + tx) / 2, y: top } }
}

/** The point halfway along a polyline, where the count label sits. */
function pointAtHalfLength(points: { x: number; y: number }[]) {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t }
    }
    remaining -= lengths[i]
  }
  return points[points.length - 1]
}

/** Spawn one short-lived particle each time `count` increases. */
function useParticles(count: number): number[] {
  const [particles, setParticles] = useState<number[]>([])
  const previous = useRef(count)
  const nextId = useRef(0)
  const timers = useRef<number[]>([])
  useEffect(() => {
    if (count > previous.current) {
      const id = nextId.current++
      setParticles((p) => [...p, id])
      // Each particle removes itself; firings can overlap, so timers are not
      // cancelled when count changes again, only on unmount.
      timers.current.push(window.setTimeout(() => setParticles((p) => p.filter((x) => x !== id)), PARTICLE_MS + 50))
    }
    previous.current = count
  }, [count])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  return particles
}

export const FlowEdge = memo(FlowEdgeView)
