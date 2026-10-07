// Only in the hosted demo: a guided tour. Each step dims the page, lights up one
// part of the UI (found by its data-tour attribute) and explains it as a short
// legend in the graph's own colours. Steps set the scene they describe (view,
// Activity, open cards), then demonstrate: the tour opens a card, clicks Expand,
// presses Fit, while the visitor watches. Ending the tour restores their settings.

import { useReactFlow } from '@xyflow/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LIVE } from '../../graph/buildGraph'
import { useStore, type View } from '../../store'
import { Check, ChevronDown, Cross, Logo } from '../icons'
import { useDemo } from './demoState'

type Flow = ReturnType<typeof useReactFlow>

interface Step {
  target?: string | (() => Element | null) // data-tour value, or a finder; none: centred
  title: string
  body: React.ReactNode
  watch?: string // what the tour is about to do, shown while it does it
  enter?: () => void // the scene, set at once
  acts?: [number, (flow: Flow) => void][] // the demonstration: ms after entering, action
  footer?: React.ReactNode
}

const REPO = 'https://github.com/YasmineZerai/loopview'

// --- setting the scene --------------------------------------------------------------

interface Scene {
  view?: View
  activity?: boolean
  expandAll?: boolean
  expanded?: string[]
  selected?: string | null
  about?: boolean // the "About this run" card, folded while the graph is being shown
  dock?: boolean // the playback bar and timeline at the bottom
}

/** Put the canvas in a known state, so a step looks the same reached forwards or back.
 * Activity is set without saving it: the visitor's own setting comes back at the end. */
function scene({ view = 'graph', activity = false, expandAll = false, expanded = [], selected = null, about = false, dock = false }: Scene = {}) {
  const { playback } = useStore.getState()
  useStore.setState({
    view,
    activity,
    expandAll,
    expanded: new Set(expanded),
    selectedKey: selected,
    highlightStep: null,
    dockOpen: dock, // set without saving it, like Activity
    playback: { ...playback, playing: false, time: LIVE },
  })
  useDemo.getState().setAboutOpen(about)
}

/** Move the replay to a share (0 to 1) of the run, as a click on the timeline does. */
function scrubTo(share: number) {
  const { selectedRunId, loaded, setPlayback } = useStore.getState()
  const run = selectedRunId ? loaded.get(selectedRunId)?.run : undefined
  if (run?.end_ns) setPlayback({ time: run.start_ns + share * (run.end_ns - run.start_ns), playing: false })
}

// The card the tour opens: picked once it is on screen, then reused by the next steps.
let demoCard: string | null = null

/** A card with calls to show, on screen, preferring one with a failed call. */
function pickCard(): string | null {
  const cards = [...document.querySelectorAll<HTMLElement>('.react-flow__node-step')].filter((el) =>
    el.querySelector('button[title^="Show calls"], button[title="Hide calls"]'),
  )
  const onScreen = cards.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight
  })
  const pool = onScreen.length ? onScreen : cards
  return (pool.find((el) => el.querySelector('.bg-state-error, .text-state-error')) ?? pool[0])?.dataset.id ?? null
}

const cardElement = () => (demoCard ? document.querySelector(`.react-flow__node[data-id="${CSS.escape(demoCard)}"]`) : null)

const openCard = (key: string | null) => (key ? [key] : [])

// --- legend pieces, in the graph's real colours -------------------------------------------

function Legend({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1.5">{children}</ul>
}

function Item({ mark = null, children }: { mark?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex h-[18px] w-8 shrink-0 items-center justify-center">{mark}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

const B = ({ children }: { children: React.ReactNode }) => <b className="font-semibold text-text">{children}</b>

const Swatch = ({ color }: { color: string }) => <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />

/** Several swatches in a row, each with its label. */
function Swatches({ items }: { items: [string, string][] }) {
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
      {items.map(([color, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <Swatch color={color} /> {label}
        </span>
      ))}
    </span>
  )
}

const AgentBox = () => (
  <span className="block h-4 w-7 rounded-[5px] border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]" />
)

const CardMark = () => (
  <span className="relative block h-4 w-7 rounded-[4px] border border-border bg-surface">
    <span className="absolute inset-y-[3px] left-0 w-[2px] rounded-r-full bg-accent" />
  </span>
)

const Arrow = () => (
  <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden>
    <path d="M1 5h21" stroke="var(--color-edge)" strokeWidth="1.5" />
    <path d="M21 1.5 26 5l-5 3.5z" fill="var(--color-edge)" />
  </svg>
)

const LoopArc = () => (
  <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden>
    <path d="M24 12C24 2 4 2 4 12" fill="none" stroke="var(--color-edge-loop)" strokeWidth="1.5" strokeDasharray="3 2.5" />
  </svg>
)

const Particle = () => (
  <svg width="28" height="10" viewBox="0 0 28 10" aria-hidden>
    <path d="M1 5h26" stroke="var(--color-edge)" strokeWidth="1.5" />
    <circle cx="16" cy="5" r="3.5" fill="var(--color-accent)" style={{ filter: 'drop-shadow(0 0 3px var(--color-accent))' }} />
  </svg>
)

const Eye = () => (
  <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
    <path d="M1 6s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" fill="none" stroke="var(--color-accent)" strokeWidth="1.4" />
    <circle cx="9" cy="6" r="2" fill="var(--color-accent)" />
  </svg>
)

const Mouse = () => (
  <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden>
    <rect x="1" y="1" width="10" height="14" rx="5" fill="none" stroke="var(--color-muted)" strokeWidth="1.4" />
    <path d="M6 3.5v3" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const Branch = () => (
  <svg width="28" height="16" viewBox="0 0 28 16" aria-hidden>
    <path d="M2 8C12 8 12 3 26 3M2 8C12 8 12 13 26 13" fill="none" stroke="var(--color-seg-system)" strokeWidth="3" strokeOpacity="0.6" />
  </svg>
)

/** A small copy of the Activity toggle, on or off. */
const Toggle = ({ on }: { on: boolean }) => (
  <span className={`inline-flex h-4 w-7 items-center rounded-full px-[2px] ${on ? 'justify-end bg-[var(--color-view-graph)]' : 'bg-border'}`}>
    <span className="h-3 w-3 rounded-full bg-surface shadow-sm" />
  </span>
)

/** Two lanes of the timeline: bars over time, one colour per agent. */
const Lanes = () => (
  <svg width="28" height="14" viewBox="0 0 28 14" aria-hidden>
    <rect x="1" y="1" width="12" height="5" rx="1.5" fill="var(--color-seg-system)" />
    <rect x="9" y="8" width="17" height="5" rx="1.5" fill="var(--color-seg-thinking)" />
  </svg>
)

const Playhead = () => (
  <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden>
    <path d="M6 3v13" stroke="var(--color-text)" strokeWidth="1.4" />
    <circle cx="6" cy="3" r="2.5" fill="var(--color-text)" />
  </svg>
)

const Chevron = () => <span className="font-mono text-[14px] font-semibold text-text">›</span>

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-canvas px-1 font-mono text-[11px] text-text">{children}</kbd>
}

// --- the steps -------------------------------------------------------------------------

const ROLES: [string, string][] = [
  ['var(--color-role-thinking)', 'thinking'],
  ['var(--color-role-assistant)', 'replies'],
  ['var(--color-role-tool)', 'tool calls'],
]

const STEPS: Step[] = [
  {
    title: 'Watch your AI agents run',
    body: (
      <Legend>
        <Item mark={<AgentBox />}>
          <B>See</B> every agent, step and tool call as a graph
        </Item>
        <Item mark={<Particle />}>
          <B>Replay</B> a run exactly as it happened
        </Item>
        <Item mark={<Cross size={14} className="text-state-error" />}>
          <B>Find</B> where it failed, and what it cost
        </Item>
      </Legend>
    ),
    footer: 'Real recorded runs, nothing to install. About two minutes.',
    enter: () => scene({ activity: true }),
  },
  {
    target: 'runs',
    title: 'Pick an example',
    body: (
      <Legend>
        <Item mark={<Check size={14} className="text-state-ok" />}>
          <B>5 agents</B>, each recorded from a real run
        </Item>
        <Item mark={<span className="font-mono text-[10.5px] text-muted">{'</>'}</span>}>
          Built with <B>LangGraph</B>, <B>Pydantic AI</B> and the plain <B>Anthropic SDK</B>
        </Item>
        <Item mark={<Chevron />}>
          <B>Click one</B> to open it
        </Item>
      </Legend>
    ),
    enter: () => {
      scene({ activity: true })
      if (!useStore.getState().sidebarOpen) useStore.getState().toggleSidebar()
    },
  },
  {
    target: 'about',
    title: 'What this agent does',
    body: (
      <Legend>
        <Item mark={<AgentBox />}>
          <B>How it's built</B>: its agents, tools and flow
        </Item>
        <Item mark={<span className="block h-4 w-[3px] rounded-full bg-accent" />}>
          <B>The prompt</B> it was given, word for word
        </Item>
        <Item mark={<Eye />}>
          <B>Look for</B>: what is worth seeing in this run
        </Item>
      </Legend>
    ),
    footer: (
      <span className="inline-flex items-center gap-1">
        It starts folded: click <B>About this run</B> to open it, <ChevronDown size={13} className="text-text" /> to fold it.
      </span>
    ),
    enter: () => scene({ activity: true, about: true }),
  },
  {
    target: 'canvas',
    title: 'Reading the graph',
    body: (
      <Legend>
        <Item mark={<AgentBox />}>
          <B>An agent</B>, with its steps inside
        </Item>
        <Item mark={<CardMark />}>
          <B>A step</B>: a node, its model calls and tools
        </Item>
        <Item mark={<Arrow />}>
          <B>What ran next</B>
        </Item>
        <Item mark={<LoopArc />}>
          <B>A loop</B> back to an earlier step; ×2 says how often
        </Item>
        <Item mark={<Particle />}>
          <B>Control moving</B>, during a replay
        </Item>
        <Item
          mark={
            <span className="flex items-center gap-1">
              <Check size={13} className="text-state-ok" />
              <Cross size={13} className="text-state-error" />
            </span>
          }
        >
          <B>Finished</B> or <b className="font-semibold text-state-error">failed</b>; a red dot on a tool is a failed call
        </Item>
      </Legend>
    ),
    enter: () => scene(),
  },
  {
    target: cardElement,
    title: 'Open a card',
    body: (
      <Legend>
        <Item mark={<Chevron />}>
          <B>Click ›</B> on a card to see inside it:
        </Item>
        <Item>
          <Swatches items={ROLES} />
        </Item>
        <Item mark={<Swatch color="var(--color-state-error)" />}>Failed calls stand out in red</Item>
      </Legend>
    ),
    watch: 'Watch: opening a card',
    enter: () => scene(),
    acts: [
      [
        300,
        () => {
          demoCard = pickCard()
          if (demoCard) useStore.getState().focusCard(demoCard)
        },
      ],
      [
        1300,
        () => {
          if (!demoCard) return
          scene({ expanded: openCard(demoCard) })
          useStore.getState().focusCard(demoCard)
        },
      ],
    ],
  },
  {
    target: 'details',
    title: 'Every detail',
    body: (
      <Legend>
        <Item mark={<CardMark />}>
          <B>Click a card</B> to open this panel
        </Item>
        <Item mark={<Swatch color="var(--color-role-user)" />}>
          <B>The full conversation</B>, coloured by who spoke
        </Item>
        <Item mark={<Swatch color="var(--color-role-tool)" />}>
          <B>Tool arguments and results</B>, errors in red
        </Item>
        <Item mark={<span className="font-mono text-[10.5px] text-muted">1.2s</span>}>
          <B>Tokens and timing</B> of every call
        </Item>
      </Legend>
    ),
    footer: (
      <>
        <Key>Esc</Key> closes it.
      </>
    ),
    watch: 'Watch: clicking the card',
    enter: () => {
      demoCard ??= pickCard()
      scene({ expanded: openCard(demoCard) })
    },
    acts: [[600, () => demoCard && useStore.setState({ selectedKey: demoCard })]],
  },
  {
    target: 'expand',
    title: 'Open them all',
    body: (
      <Legend>
        <Item mark={<Key>e</Key>}>
          <B>Expand</B> opens every card at once
        </Item>
        <Item mark={<Key>e</Key>}>
          <B>Collapse</B> closes them again
        </Item>
      </Legend>
    ),
    watch: 'Watch: expanding every card',
    enter: () => scene(),
    acts: [[900, () => useStore.setState({ expandAll: true, expanded: new Set() })]],
  },
  {
    target: 'fit',
    title: 'Lost? Fit',
    body: (
      <Legend>
        <Item mark={<Key>f</Key>}>
          <B>Fit</B> brings the whole run back on screen
        </Item>
        <Item mark={<Mouse />}>
          <B>Scroll</B> to zoom, <B>drag</B> to move around
        </Item>
      </Legend>
    ),
    watch: 'Watch: zooming in, then Fit',
    enter: () => scene({ expandAll: true }),
    acts: [
      [400, (flow) => flow.zoomTo(1.4, { duration: 500 })],
      [1700, (flow) => flow.fitView({ duration: 600, padding: 0.12 })],
    ],
  },
  {
    target: 'activity',
    title: 'Activity',
    body: (
      <Legend>
        <Item mark={<Toggle on />}>
          <B>On</B>: the running cards open, close when they're done, and the view zooms in on them
        </Item>
        <Item mark={<Toggle on={false} />}>
          <B>Off</B>: a calm overview; you open cards yourself
        </Item>
      </Legend>
    ),
    footer: (
      <>
        Shortcut: <Key>a</Key>
      </>
    ),
    watch: 'Watch: switching Activity on',
    enter: () => scene(),
    acts: [[900, () => scene({ activity: true })]],
  },
  {
    target: 'playback',
    title: 'Replay it',
    body: (
      <Legend>
        <Item mark={<Key>space</Key>}>
          <B>Play</B> or pause
        </Item>
        <Item mark={<Key>t</Key>}>
          <B>Timeline</B>: drag through the run
        </Item>
        <Item mark={<Key>← →</Key>}>
          <B>Step</B> one event at a time
        </Item>
        <Item mark={<span className="font-mono text-[10.5px] text-muted">0.5x</span>}>
          <B>Speed</B>: 0.5x, 1x or 2x
        </Item>
      </Legend>
    ),
    footer: 'The replay starts when the tour ends.',
    enter: () => scene({ activity: true }),
  },
  {
    target: 'timeline',
    title: 'The activity timeline',
    body: (
      <Legend>
        <Item mark={<Lanes />}>
          <B>One lane per agent</B>, in its colour; bars that overlap ran at the same time
        </Item>
        <Item mark={<CardMark />}>
          <B>A bar per step</B>: when it started and how long it took
        </Item>
        <Item mark={<Playhead />}>
          <B>The playhead</B>: the moment the graph shows
        </Item>
        <Item mark={<Mouse />}>
          <B>Click or drag</B> on it to jump there; hover a bar to find its card
        </Item>
      </Legend>
    ),
    footer: (
      <>
        Open it with <B>Timeline</B> under the graph, or <Key>t</Key>.
      </>
    ),
    watch: 'Watch: opening it, then jumping ahead',
    enter: () => scene({ activity: true }),
    acts: [
      [700, () => useStore.setState({ dockOpen: true })],
      [1900, () => scrubTo(0.08)],
      [3600, () => scrubTo(0.45)],
    ],
  },
  {
    target: 'tab-cost',
    title: 'Where the money went',
    body: (
      <Legend>
        <Item mark={<Branch />}>
          <B>A tree</B>: per agent, then per model call, split into
        </Item>
        <Item>
          <Swatches
            items={[
              ['var(--color-seg-system)', 'instructions'],
              ['var(--color-seg-tool_results)', 'conversation'],
              ['var(--color-seg-cache_read)', 'cache'],
              ['var(--color-seg-thinking)', 'thinking'],
              ['var(--color-seg-reply)', 'reply'],
            ]}
          />
        </Item>
        <Item mark={<span className="block h-2 w-7 rounded-full bg-muted/40" />}>
          <B>Thicker branch</B>, more money: you see what to trim
        </Item>
      </Legend>
    ),
    enter: () => scene({ view: 'cost', activity: true }),
  },
  {
    target: 'tools-findings',
    title: 'Tools, across many runs',
    body: (
      <Legend>
        <Item mark={<Swatch color="var(--color-state-error)" />}>
          <B>Which tools fail</B>, and how often
        </Item>
        <Item
          mark={
            <span className="flex gap-[2px]">
              <span className="move-fixed h-2.5 w-1.5 rounded-[2px]" />
              <span className="move-switched h-2.5 w-1.5 rounded-[2px]" />
              <span className="move-blind_retry h-2.5 w-1.5 rounded-[2px]" />
            </span>
          }
        >
          <B>What the agent did next</B>: fixed it, switched tool, retried blindly, gave up
        </Item>
        <Item mark={<Swatch color="var(--color-view-tools)" />}>
          <B>Unused tools</B>, and what their definitions cost on every call
        </Item>
      </Legend>
    ),
    footer: 'Built from the examples plus 20 tasks on GitHub’s real MCP server.',
    enter: () => scene({ view: 'tools', activity: true }),
  },
  {
    title: 'Now, your own agents',
    body: (
      <Legend>
        <Item mark={<Key>1</Key>}>
          <B>Run loopview</B> on your machine
        </Item>
        <Item mark={<Key>2</Key>}>
          <B>Point any OpenTelemetry exporter</B> at it: LangGraph, Pydantic AI, CrewAI, OpenAI Agents SDK, plain SDK calls
        </Item>
        <Item mark={<Key>3</Key>}>
          <B>Watch them live</B>, while they run
        </Item>
      </Legend>
    ),
    footer: (
      <span className="flex flex-wrap gap-x-3">
        <a className="text-accent underline-offset-2 hover:underline" href={`${REPO}#quick-start`}>
          Quick start
        </a>
        <a className="text-accent underline-offset-2 hover:underline" href={`${REPO}#connect-your-agent`}>
          Connect your agent
        </a>
      </span>
    ),
    enter: () => scene({ activity: true }),
  },
]

// --- placing the spotlight and the card --------------------------------------------------

const GAP = 14 // between the lit area and the card
const MARGIN = 16 // from the window's edges
const PAD = 6 // around the lit element

interface Box {
  top: number
  left: number
  width: number
  height: number
}

/** Where the lit element is, padded and kept on screen; null when the step has none. */
function measure(target: Step['target']): Box | null {
  if (!target) return null
  const el = typeof target === 'string' ? document.querySelector(`[data-tour="${target}"]`) : target()
  if (!el) return null
  const r = el.getBoundingClientRect()
  const top = Math.max(r.top - PAD, 4)
  const left = Math.max(r.left - PAD, 4)
  const bottom = Math.min(r.bottom + PAD, window.innerHeight - 4)
  const right = Math.min(r.right + PAD, window.innerWidth - 4)
  if (right - left < 4 || bottom - top < 4) return null
  return { top, left, width: right - left, height: bottom - top }
}

/** Beside the lit area where there is room: right, below, above, left; else inside it, top right. */
function place(box: Box | null, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - w - MARGIN))
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - h - MARGIN))
  if (!box) return { top: clampY((vh - h) / 2), left: clampX((vw - w) / 2) }
  const right = box.left + box.width
  const bottom = box.top + box.height
  if (right + GAP + w <= vw - MARGIN) return { top: clampY(box.top), left: right + GAP }
  if (bottom + GAP + h <= vh - MARGIN) return { top: bottom + GAP, left: clampX(box.left) }
  if (box.top - GAP - h >= MARGIN) return { top: box.top - GAP - h, left: clampX(box.left) }
  if (box.left - GAP - w >= MARGIN) return { top: clampY(box.top), left: box.left - GAP - w }
  return { top: clampY(box.top + MARGIN), left: clampX(right - w - MARGIN) }
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

// --- the tour ----------------------------------------------------------------------------

export function Tour() {
  const step = useDemo((s) => s.tourStep)
  const active = step !== null
  const { fitView } = useReactFlow()

  // While the tour runs: the whole run on screen, not mid-replay. Afterwards: the
  // visitor's own Activity and Expand settings, on the graph, nothing selected.
  useEffect(() => {
    if (!active) return
    const { activity, expandAll, dockOpen, setPlayback } = useStore.getState()
    const { aboutOpen, setAboutOpen } = useDemo.getState()
    setPlayback({ playing: false, time: LIVE })
    demoCard = null
    return () => {
      useStore.setState({ activity, expandAll, dockOpen, expanded: new Set(), selectedKey: null, highlightStep: null, view: 'graph' })
      setAboutOpen(aboutOpen)
      // The tour zoomed and panned; frame the whole run again once the cards have closed.
      window.setTimeout(() => fitView({ duration: 400, padding: 0.12 }), 300)
    }
  }, [active, fitView])

  if (step === null) return null
  return <TourStep index={step} />
}

function TourStep({ index }: { index: number }) {
  const { setTourStep, endTour } = useDemo.getState()
  const flow = useReactFlow()
  const step = STEPS[index]
  const last = index === STEPS.length - 1
  const card = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [size, setSize] = useState({ w: 360, h: 240 })
  const [doneStep, setDoneStep] = useState<number | null>(null) // the last step whose demonstration finished
  const watching = !!step.acts?.length && doneStep !== index

  // Set the scene, then play the demonstration; leaving the step cancels what's left of it.
  useEffect(() => {
    step.enter?.()
    const acts = step.acts ?? []
    const timers = acts.map(([ms, act]) => window.setTimeout(() => act(flow), ms))
    if (acts.length) timers.push(window.setTimeout(() => setDoneStep(index), Math.max(...acts.map(([ms]) => ms)) + 500))
    return () => timers.forEach(clearTimeout)
  }, [step, index, flow])

  // The lit element moves (the sidebar slides, cards open, the view pans), so
  // follow it every frame while the tour is open.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const next = measure(step.target)
      setBox((prev) => (sameBox(prev, next) ? prev : next))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [step])

  // The card's size decides where it fits.
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const update = () => {
      const next = { w: el.offsetWidth, h: el.offsetHeight }
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [index])

  const go = (to: number) => {
    if (to >= STEPS.length) endTour()
    else if (to >= 0) setTourStep(to)
  }

  // While the tour is open, these keys drive it rather than the graph.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handled = { Escape: endTour, ArrowRight: () => go(index + 1), Enter: () => go(index + 1), ArrowLeft: () => go(index - 1) }[e.key]
      if (!handled) return
      e.preventDefault()
      e.stopImmediatePropagation()
      handled()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const pos = place(box, size.w, size.h)
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* Catches clicks so the page underneath stays as the step left it. */}
      <div className={`absolute inset-0 ${box ? '' : 'tour-dim'}`} />
      {box && <div className="tour-spot pointer-events-none absolute rounded-xl" style={box} />}
      <div
        ref={card}
        key={index}
        className="fade-in absolute w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-surface p-4 text-[12.5px] leading-snug shadow-2xl transition-[top,left] duration-250 ease-out"
        style={pos}
      >
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span>
            {index + 1} of {STEPS.length}
          </span>
          {!last && (
            <button className="rounded px-1 hover:text-text" onClick={endTour}>
              Skip tour
            </button>
          )}
        </div>
        {index === 0 && (
          <div className="mt-1 mb-3 flex items-center gap-2.5">
            <Logo size={40} />
            <span className="text-[22px] font-semibold tracking-tight">loopview</span>
          </div>
        )}
        <h2 id="tour-title" className="mb-2.5 text-[15px] font-semibold tracking-tight">
          {step.title}
        </h2>
        <div className="text-muted">{step.body}</div>
        {step.watch && (
          <div className={`mt-3 flex items-center gap-2 rounded-md bg-overlay-soft px-2.5 py-1.5 text-[11.5px] ${watching ? 'text-accent' : 'text-muted'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${watching ? 'animate-pulse bg-accent' : 'bg-state-ok'}`} />
            {watching ? step.watch : `${step.watch.replace(/^Watch: /, '')}: done`}
          </div>
        )}
        {step.footer && <div className="mt-3 border-t border-border pt-2.5 text-[11.5px] text-muted">{step.footer}</div>}
        <div className="mt-3.5 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${i === index ? 'w-4 bg-accent' : i < index ? 'w-1.5 bg-accent/40' : 'w-1.5 bg-border'}`}
              />
            ))}
          </div>
          {index > 0 && (
            <button className="rounded-md px-2.5 py-1 text-[12.5px] text-muted hover:bg-overlay hover:text-text" onClick={() => go(index - 1)}>
              Back
            </button>
          )}
          <button
            autoFocus
            className="rounded-md bg-inverse px-3 py-1 text-[12.5px] font-medium text-canvas hover:opacity-90"
            onClick={() => go(index + 1)}
          >
            {index === 0 ? 'Start the tour' : last ? 'Explore' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
