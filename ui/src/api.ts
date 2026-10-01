// Talking to the loopview server: a few JSON endpoints and one SSE stream.

import type { NormalizedRun, RunInfo, RunUpdateEvent } from './types'

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

export const api = {
  runs: () => json<RunInfo[]>(fetch('/api/runs')),
  run: (id: string) => json<NormalizedRun>(fetch(`/api/runs/${id}`)),
  loadDemo: () => json<{ trace_ids: string[] }>(fetch('/api/demo', { method: 'POST' })),
  importFile: (file: File) =>
    json<{ trace_ids: string[] }>(fetch('/api/import', { method: 'POST', body: file })),
  exportUrl: (id: string) => `/api/runs/${id}/export`,
}

/**
 * Subscribe to live updates. EventSource reconnects by itself; `onOpen` runs on
 * every (re)connection so the caller can refetch whatever it may have missed.
 */
export function subscribe(onEvent: (e: RunUpdateEvent) => void, onOpen: () => void, onClose: () => void) {
  const source = new EventSource('/api/events')
  source.onopen = onOpen
  source.onerror = onClose
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as RunUpdateEvent)
  return () => source.close()
}
