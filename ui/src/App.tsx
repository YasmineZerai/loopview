import { otlpEndpoint } from './endpoint'

// Placeholder empty state for M0. The real empty state (setup snippet, demo button)
// and the graph view arrive in M5 to M7.
export default function App() {
  const endpoint = otlpEndpoint(window.location.origin)

  return (
    <main className="dot-grid flex h-full items-center justify-center">
      <div className="rounded-xl border border-border bg-surface px-8 py-6 text-center shadow-2xl">
        <h1 className="text-lg font-semibold tracking-tight">loopview</h1>
        <p className="mt-1 text-sm text-muted">Waiting for traces</p>
        <code className="mt-4 block rounded-md border border-border px-3 py-2 font-mono text-sm text-accent">
          {endpoint}
        </code>
      </div>
    </main>
  )
}
