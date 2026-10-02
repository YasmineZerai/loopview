// Only in the hosted demo: a short guide for first-time visitors, and the
// flagship run starts replaying by itself so the graph moves right away.

import { useEffect, useRef, useState } from 'react'
import { STATIC_DEMO } from '../api'
import { useSelectedRun } from '../store'
import { Cross } from './icons'
import { togglePlay } from './PlaybackBar'

export function DemoHint() {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <div className="fade-in absolute bottom-4 left-4 z-10 w-[300px] rounded-xl border border-border bg-surface/95 p-3.5 text-[12.5px] leading-relaxed shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-semibold">A recorded multi-agent run</span>
        <button className="rounded p-0.5 text-muted hover:bg-overlay hover:text-text" onClick={() => setOpen(false)} title="Close">
          <Cross size={13} />
        </button>
      </div>
      <ul className="space-y-1 text-muted">
        <li>
          <Key>space</Key> replay it, or drag the timeline (<Key>t</Key>)
        </li>
        <li>
          <Key>›</Key> on a card shows its thinking, replies and tool calls; <Key>e</Key> opens them all
        </li>
        <li>Click a card for every detail; other runs are on the left</li>
      </ul>
      <p className="mt-2 border-t border-border pt-2 text-muted">
        To watch your own agents live, run loopview on your machine:{' '}
        <a className="text-accent underline-offset-2 hover:underline" href="https://github.com/YasmineZerai/loopview#quick-start">
          quick start
        </a>
        .
      </p>
    </div>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-canvas px-1 font-mono text-[11px] text-text">{children}</kbd>
}

/** In the hosted demo, start replaying the first run shortly after it loads. */
export function useDemoAutoplay() {
  const loaded = useSelectedRun()
  const started = useRef(false)
  useEffect(() => {
    if (!STATIC_DEMO || started.current || !loaded) return
    started.current = true
    const timer = setTimeout(() => togglePlay(), 1200)
    return () => clearTimeout(timer)
  }, [loaded])
}
