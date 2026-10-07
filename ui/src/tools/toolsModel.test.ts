import { describe, expect, it } from 'vitest'
import toolsJson from '../test-data/tools.json'
import type { AfterError, ToolStats, ToolsReport } from '../types'
import { afterErrorBar, DEFAULT_SORT, describeAfterError, findings, nextSort, roughly, sortTools, summarySentence, viewState } from './toolsModel'

// The report over every recorded fixture, computed by the server's real code.
const recorded = toolsJson as unknown as ToolsReport

const none: AfterError = { blind_retry: 0, fixed: 0, fixed_succeeded: 0, switched: 0, gave_up: 0 }

function tool(name: string, calls: number, errors: number, avg: number | null = 10): ToolStats {
  return {
    name, calls, errors, error_rate: calls ? errors / calls : 0, after_error: none,
    top_errors: [], confused_with: [], avg_result_tokens_estimate: avg, step_refs: [],
  }
}

function report(overrides: Partial<ToolsReport['summary']> = {}, rest: Partial<ToolsReport> = {}): ToolsReport {
  return {
    summary: {
      runs: 20, tool_calls: 312, errors: 41, share_of_errors_from_top_2_tools: 0.78,
      never_called_count: 15, never_called_tokens_estimate: 180_000, never_called_tokens_per_run_estimate: 8947,
      ...overrides,
    },
    tools: [tool('a', 100, 20), tool('b', 100, 12), tool('c', 100, 9)],
    never_called: [],
    tool_list_recorded: true,
    ...rest,
  }
}

describe('sorting the table', () => {
  const tools = [tool('beta', 10, 2), tool('alpha', 30, 2), tool('gamma', 5, 4, null), tool('delta', 8, 0, 50)]

  it('defaults to errors, most first, ties by name', () => {
    expect(sortTools(tools, DEFAULT_SORT.key, DEFAULT_SORT.dir).map((t) => t.name)).toEqual(['gamma', 'alpha', 'beta', 'delta'])
  })

  it('sorts by any column, both ways', () => {
    expect(sortTools(tools, 'calls', 'asc').map((t) => t.name)).toEqual(['gamma', 'delta', 'beta', 'alpha'])
    expect(sortTools(tools, 'name', 'asc').map((t) => t.name)).toEqual(['alpha', 'beta', 'delta', 'gamma'])
    expect(sortTools(tools, 'error_rate', 'desc')[0].name).toBe('gamma')
  })

  it('keeps tools with no recorded result last, in either direction', () => {
    expect(sortTools(tools, 'avg_result_tokens_estimate', 'desc').map((t) => t.name).at(-1)).toBe('gamma')
    expect(sortTools(tools, 'avg_result_tokens_estimate', 'asc').map((t) => t.name).at(-1)).toBe('gamma')
  })

  it('does not change the input', () => {
    const before = tools.map((t) => t.name)
    sortTools(tools, 'name', 'desc')
    expect(tools.map((t) => t.name)).toEqual(before)
  })

  it('a click flips the same column, and a new numeric column starts high first', () => {
    expect(nextSort({ key: 'errors', dir: 'desc' }, 'errors')).toEqual({ key: 'errors', dir: 'asc' })
    expect(nextSort({ key: 'errors', dir: 'desc' }, 'calls')).toEqual({ key: 'calls', dir: 'desc' })
    expect(nextSort({ key: 'errors', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' })
  })
})

describe('the after-error bar', () => {
  it('has one segment per move that happened, in a fixed order, adding up to 1', () => {
    const bar = afterErrorBar({ blind_retry: 3, fixed: 0, fixed_succeeded: 0, switched: 1, gave_up: 4 })
    expect(bar.map((s) => s.id)).toEqual(['blind_retry', 'switched', 'gave_up'])
    expect(bar.map((s) => s.share)).toEqual([3 / 8, 1 / 8, 4 / 8])
  })

  it('is empty for a tool that never failed', () => {
    expect(afterErrorBar(none)).toEqual([])
  })

  it('does not count fixes that worked twice', () => {
    const bar = afterErrorBar({ ...none, fixed: 2, fixed_succeeded: 1 })
    expect(bar).toEqual([{ id: 'fixed', label: 'Fixed arguments', count: 2, share: 1 }])
    expect(describeAfterError({ ...none, fixed: 2, fixed_succeeded: 1 })).toBe('2 fixed arguments (1 worked)')
  })

  it('matches what happened in the recorded runs', () => {
    const byName = new Map(recorded.tools.map((t) => [t.name, t]))
    expect(afterErrorBar(byName.get('fetch_repo_stats')!.after_error).map((s) => s.id)).toEqual(['blind_retry'])
    expect(afterErrorBar(byName.get('get_stock')!.after_error).map((s) => s.id)).toEqual(['switched'])
    expect(afterErrorBar(byName.get('hotel_price')!.after_error).map((s) => s.id)).toEqual(['gave_up'])
  })
})

describe('the summary sentence', () => {
  it('reads like the brief', () => {
    expect(summarySentence(report())).toBe(
      '20 runs, 312 tool calls, 41 errors. 2 tools caused 78% of errors. 15 tools never used (about 8,900 tokens per run, estimated).',
    )
  })

  it('says when the tool list is not recorded instead of guessing unused tools', () => {
    const s = summarySentence(report({ never_called_count: 0 }, { tool_list_recorded: false }))
    expect(s).toContain('not recorded')
    expect(s).not.toContain('never used')
  })

  it('handles one run, no errors and no unused tools', () => {
    const s = summarySentence(report({ runs: 1, tool_calls: 1, errors: 0, share_of_errors_from_top_2_tools: null, never_called_count: 0 }, { tools: [tool('a', 1, 0)] }))
    expect(s).toBe('1 run, 1 tool call, 0 errors. Every offered tool was used.')
  })

  it('rounds the way people say numbers', () => {
    expect([roughly(42), roughly(347), roughly(8947), roughly(123_456)]).toEqual(['42', '350', '8,900', '123,000'])
  })
})

describe('empty states', () => {
  it('loading, failed, no runs, no tool calls, ready', () => {
    expect(viewState(null, false)).toBe('loading')
    expect(viewState(null, true)).toBe('failed')
    expect(viewState(report({ runs: 0, tool_calls: 0 }), false)).toBe('no-runs')
    expect(viewState(report({ tool_calls: 0 }), false)).toBe('no-calls')
    expect(viewState(recorded, false)).toBe('ready')
  })
})

describe('findings', () => {
  it('sums what the agent did after errors across tools', () => {
    const r = report({ errors: 5 })
    r.tools = [
      { ...tool('a', 10, 3), after_error: { ...none, fixed: 2, fixed_succeeded: 1, blind_retry: 1 } },
      { ...tool('b', 10, 2), after_error: { ...none, switched: 2 } },
    ]
    const recovery = findings(r).find((f) => f.id === 'recovery')!
    expect(recovery.figure).toBe('4 of 5')
    expect(recovery.detail).toBe('After an error, it fixed its arguments 2 times (1 worked), switched tool 2 times, retried blindly 1 time.')
  })

  it('names the biggest unused tool and the heaviest result', () => {
    const r = report({}, {
      never_called: [
        { name: 'small', definition_tokens_estimate: 300, carried_by_model_calls: 3 },
        { name: 'big', definition_tokens_estimate: 21_560, carried_by_model_calls: 30 },
      ],
      tools: [tool('a', 1, 0, 120), tool('b', 1, 0, 4321), tool('c', 1, 0, null)],
    })
    const byId = new Map(findings(r).map((f) => [f.id, f]))
    expect(byId.get('unused')!.figure).toBe('~180,000')
    expect(byId.get('unused')!.detail).toContain('The biggest, big, costs ~22,000 on its own.')
    expect(byId.get('heaviest')!.title).toBe('tokens per b result, on average')
  })

  it('says nothing about unused tools when the tool list is not recorded', () => {
    const ids = findings(report({ errors: 0 }, { tool_list_recorded: false })).map((f) => f.id)
    expect(ids).toEqual(['heaviest'])
  })
})
