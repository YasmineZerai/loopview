// Turn a normalized run into the graph the UI draws, at a given moment.
//
// Pure and framework-free, so it is easy to test and cheap to call on every
// animation frame during replay.
//
// - Steps that share a `key` are one graph node: a node that ran three times is
//   one card with a counter of 3, and the loop shows as an edge back to it.
// - Agents are groups; a node's group is the agent step that is its scope.
// - Model and tool calls are not graph nodes: they are listed on the node that
//   made them (tools as small satellites).
// - `time` lets replay show the run as it was at that moment: only steps that
//   had started exist, and a step is running if it had not ended yet.

import type { NormalizedRun, Step, StepStatus, TransitionKind } from '../types'

export const LIVE = Number.POSITIVE_INFINITY

/** How long after an event it still counts as "just happened" (ns). */
export const FLASH_NS = 700_000_000

export interface ToolSatellite {
  name: string
  calls: number
  errors: number
  running: boolean // a call is in progress
  flashing: boolean // a call started or finished just now
  lastStatus: StepStatus
}

export interface GraphNode {
  key: string
  name: string
  kind: 'agent' | 'node' | 'unknown'
  typeLabel: string
  groupKey: string | null // key of the enclosing agent, if any
  depth: number // nesting depth of groups
  stepIds: string[] // executions of this node, oldest first
  runCount: number
  status: StepStatus | 'idle'
  inferred: boolean
  hasError: boolean
  agentKey: string | null // the outermost agent that owns it, for its colour
  modelCalls: number
  tokens: number
  tools: ToolSatellite[]
  collapsed?: boolean // a group drawn as a single card
}

export interface GraphEdge {
  id: string
  source: string // node key
  target: string // node key
  kind: TransitionKind
  count: number
  firedAt: number // ns of the latest firing up to `time`, or -1
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Changes only when nodes, groups or edges appear, so layout reruns only then. */
  structureKey: string
}

const isFlow = (s: Step) => !s.hidden && (s.kind === 'agent' || s.kind === 'node' || s.kind === 'unknown')

function statusAt(step: Step, time: number): StepStatus {
  if (step.end_ns === null || step.end_ns > time) return 'running'
  return step.status
}

export function buildGraph(run: NormalizedRun, time: number = LIVE): Graph {
  const byId = new Map(run.steps.map((s) => [s.id, s]))
  const started = run.steps.filter((s) => s.start_ns <= time)

  // Graph nodes, one per key, in order of first appearance.
  const nodes = new Map<string, GraphNode>()
  const flowSteps = started.filter(isFlow).sort((a, b) => a.start_ns - b.start_ns)
  for (const step of flowSteps) {
    let node = nodes.get(step.key)
    if (!node) {
      const scope = step.scope_id ? byId.get(step.scope_id) : undefined
      node = {
        key: step.key,
        name: step.name,
        kind: step.kind as GraphNode['kind'],
        typeLabel: step.type_label,
        groupKey: scope && scope.kind === 'agent' ? scope.key : null,
        depth: 0,
        stepIds: [],
        runCount: 0,
        status: 'idle',
        inferred: false,
        hasError: false,
        agentKey: null,
        modelCalls: 0,
        tokens: 0,
        tools: [],
      }
      nodes.set(step.key, node)
    }
    // A key can be an agent in one run and a plain node before its children
    // arrive; the group form wins.
    if (step.kind === 'agent') node.kind = 'agent'
    node.stepIds.push(step.id)
    node.runCount += 1
  }

  // Status: running if any execution is running at `time`, else the latest one.
  for (const node of nodes.values()) {
    const executions = node.stepIds.map((id) => byId.get(id)!)
    const latest = executions[executions.length - 1]
    const running = executions.some((s) => statusAt(s, time) === 'running')
    node.status = running ? 'running' : statusAt(latest, time)
    node.inferred = latest.inferred
    node.hasError = executions.some((s) => s.status === 'error' && s.end_ns !== null && s.end_ns <= time)
  }

  // Depth and owning agent (for colour).
  for (const node of nodes.values()) {
    let depth = 0
    let group = node.groupKey ? nodes.get(node.groupKey) : undefined
    while (group) {
      depth += 1
      group = group.groupKey ? nodes.get(group.groupKey) : undefined
    }
    node.depth = depth
    node.agentKey = agentForColour(node, nodes)
  }

  // Model and tool calls, attached to the flow node of their scope.
  const toolMaps = new Map<string, Map<string, ToolSatellite>>()
  for (const step of started) {
    if (step.hidden || (step.kind !== 'model_call' && step.kind !== 'tool_call')) continue
    const scope = step.scope_id ? byId.get(step.scope_id) : undefined
    const node = scope ? nodes.get(scope.key) : undefined
    if (!node) continue
    const status = statusAt(step, time)
    if (step.kind === 'model_call') {
      node.modelCalls += 1
      node.tokens += (step.model?.input_tokens ?? 0) + (step.model?.output_tokens ?? 0)
      continue
    }
    let tools = toolMaps.get(node.key)
    if (!tools) toolMaps.set(node.key, (tools = new Map()))
    const sat = tools.get(step.name) ?? {
      name: step.name,
      calls: 0,
      errors: 0,
      running: false,
      flashing: false,
      lastStatus: 'ok' as StepStatus,
    }
    sat.calls += 1
    if (status === 'error') sat.errors += 1
    if (status === 'running') sat.running = true
    const lastEvent = status === 'running' ? step.start_ns : (step.end_ns ?? step.start_ns)
    if (time !== LIVE && time - lastEvent < FLASH_NS) sat.flashing = true
    sat.lastStatus = status
    tools.set(step.name, sat)
  }
  for (const [key, tools] of toolMaps) nodes.get(key)!.tools = [...tools.values()]

  // Edges between graph nodes, aggregated over executions. Delegate and return
  // edges are drawn by containment (the worker sits inside its supervisor's
  // group), so only edges between siblings become graph edges.
  const edges = new Map<string, GraphEdge>()
  for (const t of run.transitions) {
    if (t.kind === 'delegate' || t.kind === 'return') continue
    const source = byId.get(t.source)
    const target = byId.get(t.target)
    if (!source || !target || target.start_ns > time) continue
    if (!nodes.has(source.key) || !nodes.has(target.key)) continue
    const id = `${source.key}->${target.key}`
    const edge = edges.get(id) ?? { id, source: source.key, target: target.key, kind: t.kind, count: 0, firedAt: -1 }
    edge.count += 1
    if (t.kind === 'loop') edge.kind = 'loop'
    edge.firedAt = Math.max(edge.firedAt, target.start_ns)
    edges.set(id, edge)
  }

  const nodeList = [...nodes.values()]
  const edgeList = [...edges.values()]
  const structureKey = [
    ...nodeList.map((n) => `${n.key}|${n.groupKey ?? ''}|${n.kind}|${n.tools.length}`),
    ...edgeList.map((e) => e.id),
  ].join('\n')
  return { nodes: nodeList, edges: edgeList, structureKey }
}

// Colour (and timeline lane) comes from the innermost agent: an agent's own
// hue, or the hue of the agent group a node sits in. Every agent gets a distinct
// colour, and a node shares it with the agent it belongs to.
function agentForColour(node: GraphNode, nodes: Map<string, GraphNode>): string | null {
  if (node.kind === 'agent') return node.key
  return node.groupKey && nodes.has(node.groupKey) ? node.groupKey : null
}

/** Timestamps where something happens, for stepping through a replay. */
export function eventTimes(run: NormalizedRun): number[] {
  const times = new Set<number>()
  for (const s of run.steps) {
    if (s.hidden) continue
    times.add(s.start_ns)
    if (s.end_ns !== null) times.add(s.end_ns)
  }
  return [...times].sort((a, b) => a - b)
}

/**
 * Collapse groups: their contents disappear, the group is drawn as one card,
 * and edges into or out of anything inside it attach to the group instead.
 */
export function collapseGraph(graph: Graph, collapsed: Set<string>): Graph {
  if (collapsed.size === 0) return graph
  const byKey = new Map(graph.nodes.map((n) => [n.key, n]))
  // The outermost collapsed group containing a node, or the node itself.
  const representative = (key: string): string => {
    let result = key
    let current = byKey.get(key)
    while (current?.groupKey) {
      if (collapsed.has(current.groupKey)) result = current.groupKey
      current = byKey.get(current.groupKey)
    }
    return result
  }
  const nodes = graph.nodes
    .filter((n) => representative(n.key) === n.key)
    .map((n) => (collapsed.has(n.key) ? { ...n, collapsed: true } : n))
  const edges = new Map<string, GraphEdge>()
  for (const e of graph.edges) {
    const source = representative(e.source)
    const target = representative(e.target)
    if (source === target) continue // an edge inside a collapsed group
    const id = `${source}->${target}`
    const existing = edges.get(id)
    if (existing) {
      existing.count += e.count
      existing.firedAt = Math.max(existing.firedAt, e.firedAt)
      if (e.kind === 'loop') existing.kind = 'loop'
    } else {
      edges.set(id, { ...e, id, source, target })
    }
  }
  const edgeList = [...edges.values()]
  const structureKey = [
    ...nodes.map((n) => `${n.key}|${n.groupKey ?? ''}|${n.kind}|${n.tools.length}|${collapsed.has(n.key)}`),
    ...edgeList.map((e) => e.id),
  ].join('\n')
  return { nodes, edges: edgeList, structureKey }
}
