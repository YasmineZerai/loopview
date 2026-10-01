import { describe, expect, it } from 'vitest'
import type { NormalizedRun } from '../types'
import { buildGraph, collapseGraph, eventTimes, LIVE } from './buildGraph'
import flagshipJson from '../test-data/flagship.json'
import routerJson from '../test-data/langgraph_router.json'
import multiAgentJson from '../test-data/multi_agent_pydantic.json'
import reactJson from '../test-data/react_anthropic.json'

const flagship = flagshipJson as unknown as NormalizedRun
const router = routerJson as unknown as NormalizedRun
const multiAgent = multiAgentJson as unknown as NormalizedRun
const react = reactJson as unknown as NormalizedRun

const node = (graph: ReturnType<typeof buildGraph>, key: string) => {
  const found = graph.nodes.find((n) => n.key === key)
  if (!found) throw new Error(`no node ${key}`)
  return found
}

describe('buildGraph', () => {
  it('merges repeated executions into one node with a run counter', () => {
    const g = buildGraph(router)
    expect(node(g, 'LangGraph/agent').runCount).toBe(4)
    expect(node(g, 'LangGraph/tools').runCount).toBe(2)
    expect(g.nodes.filter((n) => n.name === 'agent')).toHaveLength(1)
  })

  it('turns loops into one back edge with a count', () => {
    const g = buildGraph(router)
    const back = g.edges.find((e) => e.id === 'LangGraph/tools->LangGraph/agent')
    expect(back).toMatchObject({ kind: 'loop', count: 2 })
    const review = g.edges.find((e) => e.id === 'LangGraph/review->LangGraph/agent')
    expect(review?.kind).toBe('loop')
  })

  it('nests agents as groups', () => {
    const g = buildGraph(flagship)
    const root = 'database_comparison'
    expect(node(g, root)).toMatchObject({ kind: 'agent', groupKey: null, depth: 0 })
    for (const a of ['benchmarks_analyst', 'operations_analyst', 'ecosystem_analyst', 'writer']) {
      expect(node(g, `${root}/${a}`)).toMatchObject({ kind: 'agent', groupKey: root, depth: 1 })
      expect(node(g, `${root}/${a}/model`)).toMatchObject({ groupKey: `${root}/${a}`, depth: 2 })
    }
  })

  it('gives each worker agent its own colour key', () => {
    const g = buildGraph(flagship)
    const keys = new Set(
      ['benchmarks_analyst', 'operations_analyst', 'ecosystem_analyst'].map(
        (a) => node(g, `database_comparison/${a}/model`).agentKey,
      ),
    )
    expect(keys.size).toBe(3)
  })

  it('attaches tools to the node that called them, with errors', () => {
    const g = buildGraph(flagship)
    const tools = node(g, 'database_comparison/ecosystem_analyst/tools').tools
    const stats = tools.find((t) => t.name === 'fetch_repo_stats')
    expect(stats).toMatchObject({ calls: 4, errors: 1 })
    expect(node(g, 'database_comparison/supervisor').modelCalls).toBe(1)
  })

  it('shows parallel branches as fan-out and fan-in edges', () => {
    const g = buildGraph(flagship)
    const fanOut = g.edges.filter((e) => e.kind === 'fan_out')
    const fanIn = g.edges.filter((e) => e.kind === 'fan_in')
    expect(fanOut.map((e) => e.source)).toEqual(Array(3).fill('database_comparison/supervisor'))
    expect(fanIn.map((e) => e.target)).toEqual(Array(3).fill('database_comparison/synthesize'))
  })

  it('does not draw delegate and return edges (containment shows them)', () => {
    const g = buildGraph(multiAgent)
    expect(g.edges.map((e) => e.kind)).toEqual(['handoff'])
    expect(node(g, 'laptop_advice/coordinator/specs_researcher').groupKey).toBe('laptop_advice/coordinator')
  })

  it('shows a single agent as one node with its tools', () => {
    const g = buildGraph(react)
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].tools.map((t) => t.name).sort()).toEqual(['calculator', 'convert_currency', 'hotel_price'])
    expect(g.nodes[0].modelCalls).toBe(3)
  })
})

describe('buildGraph at a moment in time (replay)', () => {
  const start = flagship.run.start_ns
  const supervisor = flagship.steps.find((s) => s.name === 'supervisor')!

  it('only shows what had started', () => {
    const g = buildGraph(flagship, supervisor.start_ns)
    expect(g.nodes.map((n) => n.name).sort()).toEqual(['database_comparison', 'supervisor'])
    expect(node(g, 'database_comparison/supervisor').status).toBe('running')
    expect(g.edges).toHaveLength(0)
  })

  it('marks parallel workers as running at the same time', () => {
    const t = supervisor.end_ns! + 50_000_000
    const g = buildGraph(flagship, t)
    const running = g.nodes.filter((n) => n.status === 'running' && n.name.endsWith('_analyst'))
    expect(running).toHaveLength(3)
  })

  it('keeps the layout structure stable while only statuses change', () => {
    const end = flagship.run.end_ns!
    expect(buildGraph(flagship, end).structureKey).toBe(buildGraph(flagship, LIVE).structureKey)
    expect(buildGraph(flagship, start).structureKey).not.toBe(buildGraph(flagship, end).structureKey)
  })

  it('lists event times in order for stepping', () => {
    const times = eventTimes(flagship)
    expect(times[0]).toBe(start)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})

describe('collapseGraph', () => {
  it('replaces a group by one card and reroutes edges to it', () => {
    const full = buildGraph(flagship)
    const analyst = 'database_comparison/ecosystem_analyst'
    const g = collapseGraph(full, new Set([analyst]))
    expect(g.nodes.some((n) => n.groupKey === analyst)).toBe(false)
    expect(g.nodes.find((n) => n.key === analyst)?.collapsed).toBe(true)
    // Edges between its inner nodes are gone; edges to the group itself stay.
    expect(g.edges.some((e) => e.source.startsWith(`${analyst}/`))).toBe(false)
    expect(g.edges.some((e) => e.target === analyst && e.kind === 'fan_out')).toBe(true)
    expect(g.structureKey).not.toBe(full.structureKey)
  })

  it('collapsing the whole graph leaves one card', () => {
    const g = collapseGraph(buildGraph(router), new Set(['LangGraph']))
    expect(g.nodes.map((n) => n.key)).toEqual(['LangGraph'])
    expect(g.edges).toEqual([])
  })
})
