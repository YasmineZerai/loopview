// Talking to the loopview server: a few JSON endpoints and one SSE stream.
//
// The hosted demo (`vite build --mode pages`) has no server: the same interface
// then reads recorded runs from static files (demo/index.json and one file per
// run, generated from the fixtures by the server's normalizer).

import type { NormalizedRun, RunInfo, RunUpdateEvent, ToolsReport } from './types'

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
  /** The Tools tab's report over all runs, or one session's. */
  tools: (session?: string) =>
    json<ToolsReport>(fetch(session ? `/api/tools?session=${encodeURIComponent(session)}` : '/api/tools')),
}

// --- the hosted demo -----------------------------------------------------------

// index.json lists every recorded run with its RunInfo, so the run list shows
// without downloading the runs; each run's file is fetched when it is opened.
interface IndexEntry {
  file: string
  run: RunInfo
}

let index: Promise<IndexEntry[]> | null = null
const recorded = new Map<string, Promise<NormalizedRun>>()

function loadIndex(): Promise<IndexEntry[]> {
  index ??= json<IndexEntry[]>(fetch('./demo/index.json'))
  return index
}

const staticApi: typeof serverApi = {
  runs: async () => (await loadIndex()).map((entry) => entry.run),
  run: async (id) => {
    const entry = (await loadIndex()).find((e) => e.run.id === id)
    if (!entry) throw new Error(`no recorded run ${id}`)
    if (!recorded.has(id)) recorded.set(id, json<NormalizedRun>(fetch(`./demo/${entry.file}`)))
    return recorded.get(id)!
  },
  loadDemo: async () => ({ trace_ids: [(await loadIndex())[0].run.id] }),
  importFile: async () => {
    throw new Error('Import needs a running loopview server')
  },
  exportUrl: () => '#',
  // Computed from the same recordings by the server's code at build time.
  tools: () => json<ToolsReport>(fetch('./demo/tools.json')),
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
