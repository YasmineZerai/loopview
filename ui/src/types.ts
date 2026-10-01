// The normalized schema, mirrored from server/src/loopview/normalize/schema.py.
// The UI never sees raw spans, only these shapes.

export type StepKind = 'agent' | 'node' | 'model_call' | 'tool_call' | 'unknown'
export type StepStatus = 'running' | 'ok' | 'error'
export type TransitionKind =
  | 'sequence'
  | 'loop'
  | 'fan_out'
  | 'fan_in'
  | 'handoff'
  | 'delegate'
  | 'return'

export interface MessagePart {
  type: 'text' | 'tool_call' | 'tool_result' | 'other'
  text?: string | null
  id?: string | null
  name?: string | null
  arguments?: unknown
  result?: unknown
}

export interface Message {
  role: string
  parts: MessagePart[]
}

export interface ModelCall {
  provider?: string | null
  model?: string | null
  input: Message[]
  output: Message[]
  input_tokens?: number | null
  output_tokens?: number | null
}

export interface ToolCall {
  name: string
  call_id?: string | null
  arguments?: unknown
  result?: unknown
}

export interface Step {
  id: string
  run_id: string
  parent_id: string | null
  scope_id: string | null
  kind: StepKind
  type_label: string
  name: string
  key: string
  status: StepStatus
  inferred: boolean
  hidden: boolean
  start_ns: number
  end_ns: number | null
  error?: string | null
  model?: ModelCall | null
  tool?: ToolCall | null
  input?: unknown
  output?: unknown
  convention: string
  attributes: Record<string, unknown>
}

export interface Transition {
  id: string
  source: string
  target: string
  kind: TransitionKind
  inferred: boolean
}

export interface RunInfo {
  id: string
  name: string
  service_name: string | null
  session_id: string | null
  status: StepStatus
  start_ns: number
  end_ns: number | null
  step_count: number
  last_received_ns: number
}

export interface NormalizedRun {
  run: RunInfo
  steps: Step[]
  transitions: Transition[]
}

export interface RunUpdateEvent {
  type: 'run.update'
  run: RunInfo
  steps: Step[] // only the steps that changed
  transitions: Transition[] // all of them
}
