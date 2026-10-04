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
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result' | 'other'
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

/** Token counts as the provider reported them; null means "not reported". */
export interface Usage {
  input_tokens?: number | null // includes cache reads and writes
  output_tokens?: number | null // includes thinking
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
  reasoning_tokens?: number | null
}

export type CostSegmentName =
  | 'tool_prompt'
  | 'tool_definitions'
  | 'system'
  | 'history'
  | 'tool_results'
  | 'new_input'
  | 'cache_read'
  | 'cache_write'
  | 'thinking'
  | 'reply'
  | 'unattributed'

export interface CostSegment {
  name: CostSegmentName
  side: 'input' | 'output'
  tokens: number
  dollars: number | null // null when the model has no price
}

/** Where a model call's tokens came from: estimated split, reported totals. */
export interface CallCost {
  status: 'estimated' | 'content_not_recorded' | 'no_usage'
  segments: CostSegment[]
  tokens: number | null
  dollars: number | null
  price_key: string | null
  price_source: string | null
}

export interface ModelCall {
  provider?: string | null
  model?: string | null
  input: Message[]
  output: Message[]
  tool_definitions?: unknown[]
  usage?: Usage | null
  cost?: CallCost | null
}

/** Input plus output tokens of a model call, 0 when not reported. */
export function totalTokens(call: ModelCall | null | undefined): number {
  return (call?.usage?.input_tokens ?? 0) + (call?.usage?.output_tokens ?? 0)
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
  synthetic?: boolean // a model or tools node added to a flat agent loop (server: loop_nodes.py)
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

// --- the Tools tab (server: loopview/tools/report.py) ------------------------------

export interface StepRef {
  run_id: string
  step_id: string
}

export interface AfterError {
  blind_retry: number
  fixed: number
  fixed_succeeded: number
  switched: number
  gave_up: number
}

export interface ToolStats {
  name: string
  calls: number
  errors: number
  error_rate: number
  after_error: AfterError
  top_errors: { message_group: string; count: number; example_args: unknown; example_message: string; step_ref: StepRef }[]
  confused_with: { tool: string; count: number }[]
  avg_result_tokens_estimate: number | null
  step_refs: StepRef[]
}

export interface ToolsReport {
  summary: {
    runs: number
    tool_calls: number
    errors: number
    share_of_errors_from_top_2_tools: number | null
    never_called_count: number
    never_called_tokens_estimate: number
    never_called_tokens_per_run_estimate: number
  }
  tools: ToolStats[]
  never_called: { name: string; definition_tokens_estimate: number; carried_by_model_calls: number }[]
  tool_list_recorded: boolean
}
