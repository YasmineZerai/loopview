// Only in the hosted demo: what the open example is. How the agent is built, the
// prompt it was given and what to look for, folded into a small button on request.

import { useStore } from '../../store'
import { ChevronDown, ChevronUp, Compass } from '../icons'
import { useDemo, useDemoCatalog } from './demoState'

const REPO = 'https://github.com/YasmineZerai/loopview'

export function RunAbout() {
  const runId = useStore((s) => s.selectedRunId)
  const about = useDemoCatalog().get(runId ?? '')
  const open = useDemo((s) => s.aboutOpen)
  const setOpen = useDemo((s) => s.setAboutOpen)
  if (!about) return null

  if (!open) {
    return (
      <button
        data-tour="about"
        onClick={() => setOpen(true)}
        className="fade-in absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full phone:top-3 phone:bottom-auto phone:left-3 border border-border bg-surface/95 px-3 py-1.5 text-[12px] shadow-lg backdrop-blur hover:bg-surface"
      >
        <Compass size={13} className="text-accent" /> About this run <ChevronUp size={13} className="text-muted" />
      </button>
    )
  }

  return (
    <section
      data-tour="about"
      aria-label="About this run"
      className="fade-in absolute bottom-4 left-4 z-10 flex max-h-[calc(100%-96px)] phone:top-3 phone:bottom-auto phone:left-3 phone:max-h-[calc(100%-80px)] w-[340px] max-w-[calc(100%-32px)] flex-col rounded-xl border border-border bg-surface/95 text-[12.5px] leading-relaxed shadow-lg backdrop-blur"
    >
      <header className="flex items-start gap-2 px-3.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium uppercase tracking-wider text-accent">{about.framework}</div>
          <h2 className="text-[14px] font-semibold leading-snug tracking-tight">{about.title}</h2>
        </div>
        <button className="rounded p-0.5 text-muted hover:bg-overlay hover:text-text" onClick={() => setOpen(false)} title="Fold away">
          <ChevronDown size={15} />
        </button>
      </header>
      <div className="min-h-0 space-y-2.5 overflow-y-auto px-3.5 pt-1.5 pb-3">
        <p className="text-muted">{about.summary}</p>
        <div>
          <h3 className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted">The prompt</h3>
          <blockquote className="rounded-md border-l-2 border-accent bg-overlay-soft px-2.5 py-1.5 text-text">{about.prompt}</blockquote>
        </div>
        <div>
          <h3 className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted">Look for</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-muted marker:text-border">
            {about.look_for.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <a className="inline-block text-[11.5px] text-accent underline-offset-2 hover:underline" href={`${REPO}/blob/main/${about.source}`}>
          Source: {about.source}
        </a>
      </div>
    </section>
  )
}
