// Talking to the loopview server: a few JSON endpoints and one SSE stream.
//
// The hosted demo (`vite build --mode pages`) has no server: the same interface
// then reads recorded runs from static files (demo/index.json and one file per
// run, generated from the fixtures by the server's normalizer).

import type { NormalizedRun, RunInfo, RunUpdateEvent } from './types'

/** True in the hosted demo: recorded runs, no server, nothing live. */
export const STATIC_DEMO = import.meta.env.MODE === 'pages'

async function json<T>(response: Promise<Response>): Promise<T> {
  const r = await response
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.json() as Promise<T>
}

const serverApi = {
  runs: () => json<RunInfo[]>(fetch('/api/runs')),
  run: (id: string) => json<NormalizedRun>(fetch(`/api/runs/${id}`)),
  loadDemo: () => json<{ trace_ids: string[] }>(fetch('/api/demo', { method: 'POST' })),
  importFile: (file: File) =>
    json<{ trace_ids: string[] }>(fetch('/api/import', { method: 'POST', body: file })),
  exportUrl: (id: string) => `/api/runs/${id}/export`,
}

// --- the hosted demo -----------------------------------------------------------

let recorded: Promise<NormalizedRun[]> | null = null

function loadRecorded(): Promise<NormalizedRun[]> {
  recorded ??= json<{ file: string }[]>(fetch('./demo/index.json')).then((index) =>
    Promise.all(index.map((entry) => json<NormalizedRun>(fetch(`./demo/${entry.file}`)))),
  )
  return recorded
}

const staticApi: typeof serverApi = {
  runs: async () => (await loadRecorded()).map((r) => r.run),
  run: async (id) => {
    const found = (await loadRecorded()).find((r) => r.run.id === id)
    if (!found) throw new Error(`no recorded run ${id}`)
    return found
  },
  loadDemo: async () => ({ trace_ids: [(await loadRecorded())[0].run.id] }),
  importFile: async () => {
    throw new Error('Import needs a running loopview server')
  },
  exportUrl: () => '#',
}

export const api = STATIC_DEMO ? staticApi : serverApi

/**
 * Subscribe to live updates. EventSource reconnects by itself; `onOpen` runs on
 * every (re)connection so the caller can refetch whatever it may have missed.
 */
export function subscribe(onEvent: (e: RunUpdateEvent) => void, onOpen: () => void, onClose: () => void) {
  if (STATIC_DEMO) return () => {} // recorded runs never change
  const source = new EventSource('/api/events')
  source.onopen = onOpen
  source.onerror = onClose
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as RunUpdateEvent)
  return () => source.close()
}
