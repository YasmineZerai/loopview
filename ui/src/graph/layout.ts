// Automatic layout with ELK (elkjs), run in a Web Worker so a big layout never
// blocks animation. See DECISIONS.md D8 for why ELK and not dagre: agents are
// nested groups, and ELK lays out nested graphs natively.
//
// Layout depends only on the graph's structure (graph.structureKey), not on
// statuses, so it reruns when a node or edge appears, not on every frame.

import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk-api'
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker'
import type { Graph, GraphNode } from './buildGraph'

export const NODE_WIDTH = 216
export const NODE_HEIGHT = 64
export const TOOLS_ROW_HEIGHT = 30
export const GROUP_HEADER = 40
const GROUP_PADDING = 22

export interface Box {
  x: number // relative to the parent group, as React Flow expects
  y: number
  width: number
  height: number
}

export interface Layout {
  boxes: Map<string, Box>
  // Edge routes in absolute coordinates, from ELK's orthogonal router.
  routes: Map<string, { x: number; y: number }[]>
}

const elk = new ELK({ workerFactory: () => new ElkWorker() })

// Tool pills wrap inside the card; estimate their widths (monospace, so the
// estimate is close) to reserve the right height in the layout.
const PILL_CHAR = 6.4
const PILL_PADDING = 34
const PILL_GAP = 4
const PILLS_WIDTH = NODE_WIDTH - 30

export function pillWidth(name: string, calls: number): number {
  return (name.length + (calls > 1 ? String(calls).length + 2 : 0)) * PILL_CHAR + PILL_PADDING
}

export function toolRows(node: GraphNode): number {
  let rows = 0
  let used = PILLS_WIDTH
  for (const tool of node.tools) {
    const w = Math.min(pillWidth(tool.name, tool.calls), PILLS_WIDTH)
    if (used + PILL_GAP + w > PILLS_WIDTH) {
      rows += 1
      used = w
    } else used += PILL_GAP + w
  }
  return rows
}

export function nodeHeight(node: GraphNode): number {
  const rows = toolRows(node)
  return NODE_HEIGHT + (rows > 0 ? TOOLS_ROW_HEIGHT + (rows - 1) * 24 : 0)
}

/** Groups are at least wide enough for their header. */
function groupMinWidth(node: GraphNode): number {
  return 110 + (node.name.length + node.typeLabel.length) * 8
}

export async function computeLayout(graph: Graph): Promise<Layout> {
  const children = new Map<string | null, GraphNode[]>()
  for (const node of graph.nodes) {
    const list = children.get(node.groupKey) ?? []
    list.push(node)
    children.set(node.groupKey, list)
  }

  const toElk = (node: GraphNode): ElkNode => {
    const inner = children.get(node.key)
    if (node.kind === 'agent' && inner?.length) {
      return {
        id: node.key,
        layoutOptions: {
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${groupMinWidth(node)}, 80)`,
          'elk.padding': `[top=${GROUP_HEADER + 12},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
        },
        children: inner.map(toElk),
      }
    }
    return { id: node.key, width: NODE_WIDTH, height: nodeHeight(node) }
  }

  // Loops (back edges) are left out of the layout: the layout then only sees the
  // forward flow, so steps read left to right in the order they first ran, and
  // loops are drawn as arcs back over the nodes (see FlowEdge).
  const edges: ElkExtendedEdge[] = graph.edges.filter((e) => e.kind !== 'loop').map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }))

  const root: ElkNode = {
    id: '__root__',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.nodeNode': '28',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.json.edgeCoords': 'ROOT',
    },
    children: (children.get(null) ?? []).map(toElk),
    edges,
  }

  const result = await elk.layout(root)
  const boxes = new Map<string, Box>()
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      boxes.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? NODE_WIDTH,
        height: child.height ?? NODE_HEIGHT,
      })
      visit(child)
    }
  }
  visit(result)

  const routes = new Map<string, { x: number; y: number }[]>()
  const collect = (node: ElkNode) => {
    for (const edge of (node.edges ?? []) as ElkExtendedEdge[]) {
      const section = edge.sections?.[0]
      if (section) {
        routes.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
      }
    }
    for (const child of node.children ?? []) collect(child)
  }
  collect(result)
  return { boxes, routes }
}

/** An SVG path through points with rounded corners. */
export function roundedPath(points: { x: number; y: number }[], radius = 10): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const p = points[i]
    const next = points[i + 1]
    const r = Math.min(radius, dist(prev, p) / 2, dist(p, next) / 2)
    const a = towards(p, prev, r)
    const b = towards(p, next, r)
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`
  }
  const last = points[points.length - 1]
  return `${d} L ${last.x} ${last.y}`
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
function towards(from: { x: number; y: number }, to: { x: number; y: number }, r: number) {
  const d = dist(from, to) || 1
  return { x: from.x + ((to.x - from.x) / d) * r, y: from.y + ((to.y - from.y) / d) * r }
}
