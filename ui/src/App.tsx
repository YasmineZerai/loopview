// Layout: run list on the left, the canvas in the middle. The top bar has three
// main tabs for the canvas (graph, cost tree, tools) and, to the right, quieter
// controls for the current view. Activity is shown in the graph itself (a), not
// in a side panel: the running cards open and the view zooms in on them. Details
// slide in over the graph; the playback bar and timeline are a dock at the
// bottom, hidden until asked for (a small floating control remains).

import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useEffect } from 'react'
import { api, STATIC_DEMO, subscribe } from './api'
import { useDemo, useDemoAutoplay } from './components/demo/demoState'
import { RunAbout } from './components/demo/RunAbout'
import { Tour } from './components/demo/Tour'
import { CostTree } from './components/cost/CostTree'
import { ToolsView } from './components/tools/ToolsView'
import { DetailsPanel } from './components/details/DetailsPanel'
import { EmptyState } from './components/EmptyState'
import { GraphView } from './components/graph/GraphView'
import { Activity, Coin, Compass, Download, Expand, Fit, Logo, Moon, Nodes, Sidebar, Sun, Wrench } from './components/icons'
import { MiniPlayback, PlaybackBar, stepEvent, togglePlay, usePlaybackClock } from './components/PlaybackBar'
import { RunList } from './components/RunList'
import { StatusMark } from './components/StatusMark'
import { Timeline } from './components/Timeline'
import { useSelectedRun, useStore, type View } from './store'
import { formatDuration } from './theme'

export default function App() {
  useLiveUpdates()
  usePlaybackClock()
  useDemoAutoplay()
  const hasRuns = useStore((s) => s.runs.size > 0)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const dockOpen = useStore((s) => s.dockOpen)
  const view = useStore((s) => s.view)

  return (
    <ReactFlowProvider>
      <KeyboardShortcuts />
      <div className="flex h-full flex-col bg-canvas text-text">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <aside
            data-tour="runs"
            className={`shrink-0 overflow-hidden border-r border-border bg-surface/70 transition-[width] duration-250 ease-out ${sidebarOpen && hasRuns ? 'w-64' : 'w-0'}`}
          >
            <div className="h-full w-64">
              <RunList />
            </div>
          </aside>
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div data-tour="canvas" className="relative min-h-0 flex-1 overflow-hidden">
              {hasRuns ? <GraphView /> : <EmptyState />}
              {hasRuns && view === 'cost' && <CostTree />}
              {hasRuns && view === 'tools' && <ToolsView />}
              {hasRuns && !dockOpen && <MiniPlayback />}
              {STATIC_DEMO && hasRuns && view === 'graph' && <RunAbout />}
              <DetailsPanel />
            </div>
            {hasRuns && dockOpen && (
              <div data-tour="timeline" className="h-[256px] shrink-0 border-t border-border bg-surface/70">
                <PlaybackBar />
                <div className="h-[208px] border-t border-border">
                  <Timeline />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
      {STATIC_DEMO && hasRuns && <Tour />}
    </ReactFlowProvider>
  )
}

const VIEWS: { id: View; label: string; key: string; title: string; Icon: typeof Nodes }[] = [
  { id: 'graph', label: 'Graph', key: 'g', title: 'The run as a live graph', Icon: Nodes },
  { id: 'cost', label: 'Cost', key: 'c', title: 'Where the money goes, as a tree', Icon: Coin },
  { id: 'tools', label: 'Tools', key: 'o', title: 'Which tools fail, and what the agent does next, across runs', Icon: Wrench },
]

function TopBar() {
  const loaded = useSelectedRun()
  const connected = useStore((s) => s.connected)
  const theme = useStore((s) => s.theme)
  const view = useStore((s) => s.view)
  const expandAll = useStore((s) => s.expandAll)
  const activity = useStore((s) => s.activity)
  const { toggleSidebar, toggleTheme, toggleActivity, setView, toggleExpandAll } = useStore.getState()
  const { fitView } = useReactFlow()
  const run = loaded?.run
  // Secondary controls: small and quiet next to the main tabs.
  const control = 'flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-overlay hover:text-text'

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button className="rounded-md p-1.5 text-muted hover:bg-overlay hover:text-text" onClick={toggleSidebar} title="Toggle runs">
        <Sidebar size={16} />
      </button>
      <div className="flex items-center gap-2">
        <Logo size={18} />
        <span className="text-[14px] font-semibold tracking-tight">loopview</span>
      </div>

      {run && (
        <nav className="ml-2 flex items-center gap-1 rounded-lg border border-border bg-canvas p-0.5" aria-label="Views">
          {VIEWS.map(({ id, label, key, title, Icon }) => {
            const active = view === id
            return (
              <button
                key={id}
                data-tour={`tab-${id}`}
                onClick={() => setView(id)}
                title={`${title} (${key})`}
                aria-current={active ? 'page' : undefined}
                style={{ '--tab': `var(--color-view-${id})` } as React.CSSProperties}
                className={`view-tab flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium ${active ? 'is-active' : ''}`}
              >
                <Icon size={14} className="view-tab-icon" /> {label}
              </button>
            )
          })}
        </nav>
      )}

      {run && (
        <div className="flex min-w-0 items-center gap-2 pl-1">
          <StatusMark status={run.status} size={12} />
          <span className="truncate font-mono text-[12.5px]">{run.name}</span>
          {run.service_name && <span className="hidden truncate text-[11.5px] text-muted xl:inline">{run.service_name}</span>}
          {run.end_ns !== null && <span className="font-mono text-[11.5px] text-muted">{formatDuration(run.end_ns - run.start_ns)}</span>}
        </div>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        {STATIC_DEMO && (
          <button className={`${control} mr-1`} onClick={useDemo.getState().startTour} title="A one-minute tour of loopview">
            <Compass size={13} /> Tour
          </button>
        )}
        {STATIC_DEMO ? (
          <a
            className="mr-2 flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted hover:text-text"
            href="https://github.com/YasmineZerai/loopview"
            title="These are recorded runs. Install loopview to watch your own agents live."
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Recorded demo · Get loopview
          </a>
        ) : (
          <span className="mr-2 flex items-center gap-1.5 text-[11px] text-muted" title={connected ? 'Receiving live updates' : 'Reconnecting'}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-state-ok' : 'bg-state-idle'}`} />
            {connected ? 'connected' : 'offline'}
          </span>
        )}
        {run && view === 'graph' && (
          <>
            <button
              data-tour="activity"
              className={`${control} ${activity ? 'text-text' : ''}`}
              onClick={toggleActivity}
              aria-pressed={activity}
              title="Follow what happens: the running cards open, close when done, and the view zooms in on them (a)"
            >
              <Activity size={13} /> Activity
              <span className={`ml-0.5 h-1.5 w-1.5 rounded-full ${activity ? 'bg-[var(--color-view-graph)]' : 'bg-border'}`} />
            </button>
            <button data-tour="expand" className={`${control} ${expandAll ? 'text-text' : ''}`} onClick={toggleExpandAll} title="Show every step's calls inside the graph (e)">
              <Expand size={13} /> {expandAll ? 'Collapse' : 'Expand'}
            </button>
            <button data-tour="fit" className={control} onClick={() => fitView({ duration: 300, padding: 0.12 })} title="Fit to screen (f)">
              <Fit size={13} /> Fit
            </button>
          </>
        )}
        {run && !STATIC_DEMO && (
          <a className={control} href={api.exportUrl(run.id)} title="Export this run as JSONL">
            <Download size={13} /> Export
          </a>
        )}
        <span className="mx-1 h-4 w-px bg-border" />
        <button className={control} onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          {theme === 'light' ? <Moon size={13} /> : <Sun size={13} />}
        </button>
      </div>
    </header>
  )
}

function KeyboardShortcuts() {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const store = useStore.getState()
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowRight') stepEvent(1)
      else if (e.key === 'ArrowLeft') stepEvent(-1)
      else if (e.key === 'f') fitView({ duration: 300, padding: 0.12 })
      else if (e.key === 't') store.toggleDock()
      else if (e.key === 'a') store.toggleActivity()
      else if (e.key === 'g') store.setView('graph')
      else if (e.key === 'c') store.setView(store.view === 'cost' ? 'graph' : 'cost')
      else if (e.key === 'o') store.setView(store.view === 'tools' ? 'graph' : 'tools')
      else if (e.key === 'e') store.toggleExpandAll()
      else if (e.key === 'Escape') store.setSelectedKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView])
  return null
}

function useLiveUpdates() {
  useEffect(() => {
    const store = useStore.getState
    const refresh = () => api.runs().then(store().setRuns).catch(() => {})
    refresh()
    return subscribe(
      (event) => store().applyUpdate(event),
      () => {
        store().setConnected(true)
        refresh() // catch up on anything missed while disconnected
      },
      () => store().setConnected(false),
    )
  }, [])
}
