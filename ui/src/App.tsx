// Layout: run list on the left, the graph in the middle, the activity feed or
// the cost tab on the right. Details slide in over the graph; the playback bar and timeline are
// a dock at the bottom, hidden until asked for (a small floating control remains).

import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useEffect } from 'react'
import { api, STATIC_DEMO, subscribe } from './api'
import { DemoHint, useDemoAutoplay } from './components/DemoHint'
import { ActivityFeed } from './components/ActivityFeed'
import { CostPanel } from './components/cost/CostPanel'
import { DetailsPanel } from './components/details/DetailsPanel'
import { EmptyState } from './components/EmptyState'
import { GraphView } from './components/graph/GraphView'
import { Activity, Coin, Download, Expand, Fit, Logo, Moon, Sidebar, Sun } from './components/icons'
import { MiniPlayback, PlaybackBar, stepEvent, togglePlay, usePlaybackClock } from './components/PlaybackBar'
import { RunList } from './components/RunList'
import { StatusMark } from './components/StatusMark'
import { Timeline } from './components/Timeline'
import { useSelectedRun, useStore } from './store'
import { formatDuration } from './theme'

export default function App() {
  useLiveUpdates()
  usePlaybackClock()
  useDemoAutoplay()
  const hasRuns = useStore((s) => s.runs.size > 0)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const dockOpen = useStore((s) => s.dockOpen)
  const panel = useStore((s) => s.panel)

  return (
    <ReactFlowProvider>
      <KeyboardShortcuts />
      <div className="flex h-full flex-col bg-canvas text-text">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <aside
            className={`shrink-0 overflow-hidden border-r border-border bg-surface/70 transition-[width] duration-250 ease-out ${sidebarOpen && hasRuns ? 'w-64' : 'w-0'}`}
          >
            <div className="h-full w-64">
              <RunList />
            </div>
          </aside>
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {hasRuns ? <GraphView /> : <EmptyState />}
              {hasRuns && !dockOpen && <MiniPlayback />}
              {STATIC_DEMO && hasRuns && <DemoHint />}
              <DetailsPanel />
            </div>
            {hasRuns && dockOpen && (
              <div className="h-[256px] shrink-0 border-t border-border bg-surface/70">
                <PlaybackBar />
                <div className="h-[208px] border-t border-border">
                  <Timeline />
                </div>
              </div>
            )}
          </main>
          <aside
            className={`shrink-0 overflow-hidden border-l border-border bg-canvas transition-[width] duration-250 ease-out ${panel && hasRuns ? 'w-[380px]' : 'w-0'}`}
          >
            <div className="h-full w-[380px]">
              {panel === 'cost' ? <CostPanel /> : <ActivityFeed />}
            </div>
          </aside>
        </div>
      </div>
    </ReactFlowProvider>
  )
}

function TopBar() {
  const loaded = useSelectedRun()
  const connected = useStore((s) => s.connected)
  const theme = useStore((s) => s.theme)
  const panel = useStore((s) => s.panel)
  const expandAll = useStore((s) => s.expandAll)
  const { toggleSidebar, toggleTheme, togglePanel, toggleExpandAll } = useStore.getState()
  const { fitView } = useReactFlow()
  const run = loaded?.run
  const button = 'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted hover:bg-overlay hover:text-text'

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <button className="rounded-md p-1.5 text-muted hover:bg-overlay hover:text-text" onClick={toggleSidebar} title="Toggle runs">
        <Sidebar size={16} />
      </button>
      <div className="flex items-center gap-2">
        <Logo size={18} />
        <span className="text-[14px] font-semibold tracking-tight">loopview</span>
      </div>
      {run && (
        <div className="flex min-w-0 items-center gap-2.5 border-l border-border pl-3">
          <StatusMark status={run.status} size={13} />
          <span className="truncate font-mono text-[13px]">{run.name}</span>
          {run.service_name && <span className="truncate text-[12px] text-muted">{run.service_name}</span>}
          {run.end_ns !== null && <span className="font-mono text-[12px] text-muted">{formatDuration(run.end_ns - run.start_ns)}</span>}
        </div>
      )}
      <div className="ml-auto flex items-center gap-1">
        {STATIC_DEMO ? (
          <a
            className="mr-1 flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted hover:text-text"
            href="https://github.com/YasmineZerai/loopview"
            title="These are recorded runs. Install loopview to watch your own agents live."
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Recorded demo · Get loopview
          </a>
        ) : (
          <span className="mr-2 flex items-center gap-1.5 text-[11.5px] text-muted" title={connected ? 'Receiving live updates' : 'Reconnecting'}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-state-ok' : 'bg-state-idle'}`} />
            {connected ? 'connected' : 'offline'}
          </span>
        )}
        {run && (
          <>
            <button className={button} onClick={() => fitView({ duration: 300, padding: 0.12 })} title="Fit to screen (f)">
              <Fit size={14} /> Fit
            </button>
            <button
              className={`${button} ${expandAll ? 'bg-overlay text-text' : ''}`}
              onClick={toggleExpandAll}
              title="Show every step's calls inside the graph (e)"
            >
              <Expand size={14} /> {expandAll ? 'Collapse all' : 'Expand all'}
            </button>
            {!STATIC_DEMO && (
              <a className={button} href={api.exportUrl(run.id)} title="Export this run as JSONL">
                <Download size={14} /> Export
              </a>
            )}
            <button
              className={`${button} ${panel === 'activity' ? 'bg-overlay text-text' : ''}`}
              onClick={() => togglePanel('activity')}
              title="Show what the agents think, say and do (a)"
            >
              <Activity size={14} /> Activity
            </button>
            <button
              className={`${button} ${panel === 'cost' ? 'bg-overlay text-text' : ''}`}
              onClick={() => togglePanel('cost')}
              title="Show where the money goes (c)"
            >
              <Coin size={14} /> Cost
            </button>
          </>
        )}
        <button className={button} onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
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
      else if (e.key === 'a') store.togglePanel('activity')
      else if (e.key === 'c') store.togglePanel('cost')
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
