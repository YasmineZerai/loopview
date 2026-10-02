// The cost tree: the run, its agents, their steps, and what each step's tokens
// were spent on, drawn left to right as branches whose thickness is cost.
//
// Built from a CostSummary, so it follows the same clock as everything else
// (live, or what had finished by the replay time). Pure functions: the
// component only draws what `layoutTree` returns.

import type { CostSegmentName } from '../types'
import { SEGMENTS, type Amount, type CostSummary, type Split } from './costModel'

export type TreeLevel = 'run' | 'agent' | 'step' | 'segment'
export type Unit = 'dollars' | 'tokens'

export interface CostNode {
  id: string // a path, unique in the tree: "run/agentKey/cardKey/segment"
  level: TreeLevel
  name: string
  amount: Amount
  split: Split // what this node's tokens were spent on
  agentKey: string | null
  cardKey: string | null // the graph card, for steps and their segments
  segment?: CostSegmentName
  parent: CostNode | null
  children: CostNode[]
}

const empty = (): Amount => ({ tokens: 0, dollars: 0 })

function addSplit(into: Split, from: Split) {
  for (const [name, a] of Object.entries(from) as [CostSegmentName, Amount][]) {
    const t = (into[name] ??= empty())
    t.tokens += a.tokens
    t.dollars += a.dollars
  }
}

function node(level: TreeLevel, id: string, name: string, agentKey: string | null, cardKey: string | null): CostNode {
  return { id, level, name, amount: empty(), split: {}, agentKey, cardKey, parent: null, children: [] }
}

/**
 * Group the calls into run -> agent -> step -> segment. Nodes worth nothing in
 * `unit` are left out (a model with no price has no branch in dollars). Agents
 * and steps are sorted largest first; segments keep prompt order, so the same
 * colours sit in the same order everywhere.
 */
export function buildCostTree(summary: CostSummary, cardName: (key: string) => string, unit: Unit): CostNode {
  const root = node('run', 'run', 'whole run', null, null)
  root.amount = { ...summary.total }
  addSplit(root.split, summary.split)

  const agents = new Map<string | null, CostNode>()
  const steps = new Map<string, CostNode>()
  const runs = new Map<string, number>() // executions per step
  for (const call of summary.calls) {
    let agent = agents.get(call.agentKey)
    if (!agent) {
      const name = summary.byAgent.find((a) => a.agentKey === call.agentKey)?.name ?? 'run'
      agent = node('agent', `run/${call.agentKey ?? '-'}`, name, call.agentKey, null)
      agents.set(call.agentKey, agent)
    }
    const stepId = `${agent.id}/${call.nodeKey ?? '-'}`
    let step = steps.get(stepId)
    if (!step) {
      step = node('step', stepId, call.nodeKey ? cardName(call.nodeKey) : 'outside any step', call.agentKey, call.nodeKey)
      steps.set(stepId, step)
      agent.children.push(step)
    }
    runs.set(stepId, (runs.get(stepId) ?? 0) + 1)
    for (const target of [agent, step]) {
      target.amount.tokens += call.total.tokens
      target.amount.dollars += call.total.dollars
      addSplit(target.split, call.split)
    }
  }

  for (const step of steps.values()) {
    const n = runs.get(step.id) ?? 1
    if (n > 1) step.name = `${step.name} ×${n}`
    for (const seg of SEGMENTS) {
      const amount = step.split[seg.id]
      if (!amount) continue
      const leaf = node('segment', `${step.id}/${seg.id}`, seg.label, step.agentKey, step.cardKey)
      leaf.amount = { ...amount }
      leaf.split = { [seg.id]: { ...amount } }
      leaf.segment = seg.id
      step.children.push(leaf)
    }
  }
  root.children = [...agents.values()]

  const prune = (n: CostNode) => {
    n.children = n.children.filter((c) => c.amount[unit] > 0)
    if (n.level !== 'step') n.children.sort((a, b) => b.amount[unit] - a.amount[unit])
    for (const c of n.children) {
      c.parent = n
      prune(c)
    }
  }
  prune(root)
  return root
}

// --- layout -------------------------------------------------------------------------

export interface Placed {
  node: CostNode
  x: number // left of the bar
  y: number // top of the bar
  h: number // bar height: the node's cost
  depth: number
}

/** A branch from a parent's bar to a child's, as thick as the child's cost. */
export interface Branch {
  id: string
  from: Placed
  to: Placed
  y0: number // where it leaves the parent's bar (top edge)
  path: string
}

export interface TreeLayout {
  nodes: Placed[]
  branches: Branch[]
  width: number
  height: number
}

export interface LayoutOptions {
  width: number // of the drawing area
  unit: Unit
  expanded: Set<string> // step ids showing their segments
  trunk?: number // px height of the run's bar
  bar?: number // px width of every bar
  label?: number // px reserved right of the last column for labels
}

export const BAR_WIDTH = 12
const SLOT_MIN = 40 // px a leaf takes at least, so labels never overlap
const SLOT_GAP = 12
const PAD_Y = 28
const PAD_X = 24
const MIN_BAR = 2 // tiny costs stay visible
const LEAD_MAX = 150

/**
 * Place the tree left to right. Columns: run, agents, steps, and segments when
 * a step is expanded. Leaves are stacked top to bottom with room for a label;
 * each parent is centred on its children. Bars are as tall as their cost, and
 * the branches leaving a bar stack up to exactly its height, so the cost can be
 * followed from the trunk to every leaf.
 */
export function layoutTree(root: CostNode, opts: LayoutOptions): TreeLayout {
  const { width, unit, expanded } = opts
  const trunk = opts.trunk ?? 280
  const bar = opts.bar ?? BAR_WIDTH
  const label = opts.label ?? 190
  const total = root.amount[unit]
  const scale = total > 0 ? trunk / total : 0
  const heightOf = (n: CostNode) => Math.max(MIN_BAR, n.amount[unit] * scale)

  const visibleChildren = (n: CostNode) => (n.level === 'step' && !expanded.has(n.id) ? [] : n.children)
  const hasSegments = root.children.some((a) => a.children.some((s) => expanded.has(s.id) && s.children.length > 0))
  const columns = hasSegments ? 4 : 3
  const colWidth = Math.max(170, (width - PAD_X * 2 - label - bar) / (columns - 1))

  const nodes: Placed[] = []
  let cursor = PAD_Y
  const place = (n: CostNode, depth: number): Placed => {
    const h = heightOf(n)
    const x = PAD_X + depth * colWidth
    const kids = visibleChildren(n)
    let y: number
    let placedKids: Placed[] = []
    if (kids.length === 0) {
      const slot = Math.max(h, SLOT_MIN)
      y = cursor + (slot - h) / 2
      cursor += slot + SLOT_GAP
    } else {
      placedKids = kids.map((k) => place(k, depth + 1))
      const first = placedKids[0]
      const last = placedKids[placedKids.length - 1]
      const centre = (first.y + first.h / 2 + last.y + last.h / 2) / 2
      y = centre - h / 2
    }
    const p: Placed = { node: n, x, y, h, depth }
    nodes.push(p)
    return p
  }
  place(root, 0)

  const byId = new Map(nodes.map((p) => [p.node.id, p]))
  const branches: Branch[] = []
  for (const parent of nodes) {
    let offset = parent.y
    const kids = visibleChildren(parent.node)
    const sum = kids.reduce((s, k) => s + heightOf(k), 0)
    // Squeeze evenly if the minimum bar heights overflow the parent.
    const fit = sum > parent.h ? parent.h / sum : 1
    for (const k of kids) {
      const child = byId.get(k.id)!
      const h = heightOf(k) * fit
      // Straight for a while first, so the parent's label sits on a calm band.
      const lead = Math.min(LEAD_MAX, (child.x - parent.x - bar) * 0.42)
      branches.push({ id: `${parent.node.id}>${k.id}`, from: parent, to: child, y0: offset, path: ribbon(parent.x + bar, offset, child.x, child.y, h, child.h, lead) })
      offset += h
    }
  }

  const right = Math.max(...nodes.map((p) => p.x)) + bar + label
  const bottom = Math.max(...nodes.map((p) => p.y + p.h), cursor)
  return { nodes, branches, width: Math.max(width, right + PAD_X), height: bottom + PAD_Y }
}

/**
 * A band from (x0, y0..y0+h0) on the left to (x1, y1..y1+h1) on the right:
 * straight for `lead` px, then an S-curve.
 */
export function ribbon(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, lead = 0): string {
  const xs = x0 + lead
  const xm = (xs + x1) / 2
  const f = (v: number) => Math.round(v * 10) / 10
  return [
    `M${f(x0)},${f(y0)}`,
    `L${f(xs)},${f(y0)}`,
    `C${f(xm)},${f(y0)} ${f(xm)},${f(y1)} ${f(x1)},${f(y1)}`,
    `L${f(x1)},${f(y1 + h1)}`,
    `C${f(xm)},${f(y1 + h1)} ${f(xm)},${f(y0 + h0)} ${f(xs)},${f(y0 + h0)}`,
    `L${f(x0)},${f(y0 + h0)}`,
    'Z',
  ].join(' ')
}

/** The path from the run down to `n`. */
export function ancestry(n: CostNode): CostNode[] {
  const path: CostNode[] = []
  for (let c: CostNode | null = n; c; c = c.parent) path.unshift(c)
  return path
}

/** Every node, parents before children. */
export function flatten(root: CostNode): CostNode[] {
  const out: CostNode[] = []
  const walk = (n: CostNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(root)
  return out
}
