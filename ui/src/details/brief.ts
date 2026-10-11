// What the details panel says about a step, kept out of the components so it can
// be tested: which model and tool calls belong to it, an agent's brief (its
// instructions, its task and its final answer), and a model call split into what
// matters first (the output, what is new in the input) and the rest.

import type { Message, ModelCall, Step } from '../types'

const isCall = (s: Step) => s.kind === 'model_call' || s.kind === 'tool_call'

/** The model and tool calls an execution made. An agent's are all the calls
 * inside it, through its nodes (LangGraph's, or the `model` and `tools` nodes
 * drawn in a flat loop), except those of another agent it called. A node's are
 * its own: through drawn-in nodes only, not through another real node. */
export function callsOf(step: Step, all: Step[]): Step[] {
  const byId = new Map(all.map((s) => [s.id, s]))
  const stopsAt = (s: Step) =>
    !s.synthetic && (s.kind === 'agent' || (step.kind !== 'agent' && s.kind === 'node'))
  const owner = (call: Step): string | null => {
    let parent = call.parent_id ? byId.get(call.parent_id) : undefined
    while (parent) {
      if (parent.id === step.id) return step.id
      if (stopsAt(parent)) return parent.id
      parent = parent.parent_id ? byId.get(parent.parent_id) : undefined
    }
    return null
  }
  return all
    .filter((s) => !s.hidden && isCall(s) && owner(s) === step.id)
    .sort((a, b) => a.start_ns - b.start_ns || a.id.localeCompare(b.id))
}

/** Every call inside a step, its sub-agents' too: for an agent that only
 * delegates, what went in and came out goes through the agents it called. */
export function allCallsIn(step: Step, all: Step[]): Step[] {
  const byId = new Map(all.map((s) => [s.id, s]))
  const inside = (call: Step) => {
    for (let p = call.parent_id ? byId.get(call.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
      if (p.id === step.id) return true
    }
    return false
  }
  return all
    .filter((s) => !s.hidden && isCall(s) && inside(s))
    .sort((a, b) => a.start_ns - b.start_ns || a.id.localeCompare(b.id))
}

const textOf = (messages: Message[]): string =>
  messages
    .flatMap((m) => m.parts)
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!.trim())
    .join('\n\n')

export interface Brief {
  instructions: string | null // the system prompt
  task: string | null // what the agent was asked: the first user message
  answer: string | null // the text of its last output that has any
  modelCalls: number
  toolCalls: number
  tokens: number | null // reported input + output over its model calls; null if none reported
}

/** An agent's brief, from its own model calls. Every field is read from what the
 * trace recorded; null when it didn't record it. */
export function brief(calls: Step[]): Brief {
  const models = calls.filter((c) => c.kind === 'model_call' && c.model).map((c) => c.model!)
  const first = models[0]
  const firstUser = first?.input.find((m) => m.role === 'user' && textOf([m]))
  const answer = [...models].reverse().map((m) => textOf(m.output)).find(Boolean)
  const reported = models.filter((m) => m.usage?.input_tokens != null || m.usage?.output_tokens != null)
  return {
    instructions: (first && textOf(first.input.filter((m) => m.role === 'system'))) || null,
    task: (firstUser && textOf([firstUser])) || null,
    answer: answer || null,
    modelCalls: models.length,
    toolCalls: calls.filter((c) => c.kind === 'tool_call').length,
    tokens: reported.length
      ? reported.reduce((n, m) => n + (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0), 0)
      : null,
  }
}

export interface CallParts {
  system: Message[]
  history: Message[] // resent from earlier turns
  latest: Message[] // what is new on this call: everything after the last assistant message
  output: Message[]
}

/** A model call's input repeats the whole history; what is new is what follows
 * the last assistant message (the user's message, or the tool results). */
export function splitCall(call: ModelCall): CallParts {
  const rest = call.input.filter((m) => m.role !== 'system')
  const lastAssistant = rest.map((m) => m.role).lastIndexOf('assistant')
  return {
    system: call.input.filter((m) => m.role === 'system'),
    history: rest.slice(0, lastAssistant + 1),
    latest: rest.slice(lastAssistant + 1),
    output: call.output,
  }
}

/** Tools often return JSON as a string; show it as JSON. Anything else stays as is. */
export function parsedIfJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!(text.startsWith('{') || text.startsWith('['))) return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

/** A one-line description of a value, for a collapsed tool result. */
export function summarize(value: unknown): string {
  const v = parsedIfJson(value)
  if (v === null || v === undefined) return 'empty'
  if (typeof v === 'string') return `${v.length.toLocaleString('en-US')} characters`
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') return `${Object.keys(v).length} keys`
  return String(v)
}
