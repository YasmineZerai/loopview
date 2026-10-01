// Colours and formatting shared by the graph, the timeline and the panels.
//
// Two separate colour systems, never mixed:
// - agent hues say WHO: each worker agent gets its own hue for its group, its
//   nodes and its timeline lane;
// - state colours say WHAT is happening, the same everywhere: running glows in
//   white, success is green, error is red.

import type { StepStatus } from './types'

// No red or green here: those are reserved for state.
const AGENT_HUES = ['#7c9cff', '#c084fc', '#22d3ee', '#f5b94a', '#f472b6', '#fb923c', '#a78bfa', '#2dd4bf']
export const NEUTRAL_HUE = '#8b93a7'

export const STATE = {
  running: '#f4f4f5',
  ok: '#4ade80',
  error: '#f87171',
  idle: '#52525b',
} as const

/** Stable hue per agent key, in order of first appearance. */
export function hueMap(agentKeys: (string | null)[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const key of agentKeys) {
    if (key && !map.has(key)) map.set(key, AGENT_HUES[map.size % AGENT_HUES.length])
  }
  return map
}

export function stateColour(status: StepStatus | 'idle'): string {
  return STATE[status]
}

export function formatDuration(ns: number): string {
  const ms = ns / 1e6
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function timeAgo(ns: number): string {
  const s = Math.max(0, (Date.now() - ns / 1e6) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
