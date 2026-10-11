import { describe, expect, it } from 'vitest'
import failingJson from '../test-data/failing_tools_pydantic.json'
import flagshipJson from '../test-data/flagship.json'
import multiAgentJson from '../test-data/multi_agent_pydantic.json'
import routerJson from '../test-data/langgraph_router.json'
import type { ModelCall, NormalizedRun, Step } from '../types'
import { allCallsIn, brief, callsOf, parsedIfJson, splitCall, summarize } from './brief'

const failing = failingJson as unknown as NormalizedRun
const flagship = flagshipJson as unknown as NormalizedRun
const multiAgent = multiAgentJson as unknown as NormalizedRun
const router = routerJson as unknown as NormalizedRun

const step = (run: NormalizedRun, name: string, kind: Step['kind'] = 'agent') =>
  run.steps.find((s) => s.name === name && s.kind === kind && !s.hidden && !s.synthetic)!
const visibleCalls = (run: NormalizedRun) => run.steps.filter((s) => !s.hidden && (s.kind === 'model_call' || s.kind === 'tool_call'))

describe('which calls belong to a step', () => {
  it('gives a flat agent loop its calls, through the drawn-in model and tools nodes', () => {
    const calls = callsOf(step(failing, 'shop_assistant'), failing.steps)
    expect(calls).toHaveLength(visibleCalls(failing).length)
    expect(calls.map((c) => c.start_ns)).toEqual([...calls.map((c) => c.start_ns)].sort((a, b) => a - b))
  })

  it("leaves a sub-agent's calls to the sub-agent", () => {
    const coordinator = callsOf(step(multiAgent, 'coordinator'), multiAgent.steps)
    const specs = callsOf(step(multiAgent, 'specs_researcher'), multiAgent.steps)
    expect(coordinator.length).toBeGreaterThan(0)
    expect(specs.length).toBeGreaterThan(0)
    expect(coordinator.some((c) => specs.includes(c))).toBe(false)
  })

  it("gives a LangGraph agent its nodes' calls, and each node only its own", () => {
    const graph = callsOf(step(flagship, 'database_comparison'), flagship.steps)
    const analyst = callsOf(step(flagship, 'benchmarks_analyst'), flagship.steps)
    expect(graph.length).toBeGreaterThan(0)
    expect(analyst.length).toBeGreaterThan(0)
    expect(graph.some((c) => analyst.includes(c))).toBe(false)
    const classify = step(router, 'classify', 'node')
    expect(callsOf(classify, router.steps).every((c) => c.scope_id === classify.id)).toBe(true)
  })

  it('gives every recorded agent something to show, its own calls or its sub-agents', () => {
    for (const run of [failing, flagship, multiAgent, router]) {
      for (const agent of run.steps.filter((s) => s.kind === 'agent' && !s.synthetic && !s.hidden)) {
        const own = callsOf(agent, run.steps)
        const shown = own.length ? own : allCallsIn(agent, run.steps)
        expect(brief(shown).task, agent.name).toBeTruthy()
        expect(brief(shown).answer, agent.name).toBeTruthy()
      }
    }
  })

  it("reads an agent that only delegates from the agents it called", () => {
    const top = step(multiAgent, 'laptop_advice')
    expect(callsOf(top, multiAgent.steps)).toEqual([])
    const writer = brief(callsOf(step(multiAgent, 'writer'), multiAgent.steps))
    expect(brief(allCallsIn(top, multiAgent.steps)).answer).toBe(writer.answer) // the last word is the writer's
  })
})

describe("an agent's brief", () => {
  it('reads the instructions, the task and the final answer from its model calls', () => {
    const b = brief(callsOf(step(failing, 'shop_assistant'), failing.steps))
    expect(b.task).toBeTruthy()
    expect(b.answer).toBeTruthy()
    expect(b.modelCalls).toBeGreaterThan(1)
    expect(b.toolCalls).toBeGreaterThan(0)
    expect(b.tokens).toBeGreaterThan(0)
  })

  it('says null for what the trace did not record, never an empty guess', () => {
    const b = brief([])
    expect(b).toEqual({ instructions: null, task: null, answer: null, modelCalls: 0, toolCalls: 0, tokens: null })
  })
})

describe('a model call, split', () => {
  const call = (input: ModelCall['input']): ModelCall => ({ input, output: [], tool_definitions: [] })
  const text = (role: string, t: string) => ({ role, parts: [{ type: 'text' as const, text: t }] })

  it("puts what follows the last assistant message as what's new", () => {
    const parts = splitCall(call([text('system', 's'), text('user', 'q'), text('assistant', 'a'), text('tool', 'r1'), text('tool', 'r2')]))
    expect(parts.system).toHaveLength(1)
    expect(parts.history.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(parts.latest.map((m) => m.parts[0].text)).toEqual(['r1', 'r2'])
  })

  it('treats the first call as all new', () => {
    const parts = splitCall(call([text('system', 's'), text('user', 'q')]))
    expect(parts.history).toEqual([])
    expect(parts.latest).toHaveLength(1)
  })
})

describe('tool results', () => {
  it('shows JSON stored in a string as JSON, and leaves other strings alone', () => {
    expect(parsedIfJson('{"items": [1, 2]}')).toEqual({ items: [1, 2] })
    expect(parsedIfJson('[not json')).toBe('[not json')
    expect(parsedIfJson('plain text')).toBe('plain text')
  })

  it('summarizes a result in a few words', () => {
    expect(summarize('{"a": 1, "b": 2}')).toBe('2 keys')
    expect(summarize([1, 2, 3])).toBe('3 items')
    expect(summarize('x'.repeat(1200))).toBe('1,200 characters')
    expect(summarize(null)).toBe('empty')
  })
})
