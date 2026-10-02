// App state, in one small zustand store.
//
// Runs arrive as a list of RunInfo; the full normalized run (steps and
// transitions) is fetched for the selected run and then kept up to date by live
// events, which carry only the steps that changed.

import { create } from 'zustand'
import { api } from './api'
import { LIVE } from './graph/buildGraph'
import type { NormalizedRun, RunInfo, RunUpdateEvent, Step, Transition } from './types'

export interface LoadedRun {
  run: RunInfo
  steps: Map<string, Step>
  transitions: Transition[]
  version: number // bumped on every change, for memoisation
  view: NormalizedRun // arrays, rebuilt on change
}

export interface Playback {
  time: number // ns; LIVE shows everything
  playing: boolean
  speed: number
}

interface State {
  runs: Map<string, RunInfo>
  loaded: Map<string, LoadedRun>
  selectedRunId: string | null
  followLive: boolean // select new runs as they arrive
  selectedKey: string | null // graph node shown in the details panel
  hoverKey: string | null // graph node hovered in the graph or the timeline
  collapsed: Set<string> // collapsed groups
  // Cards showing their calls inline. With expandAll on, the set lists the
  // cards the user closed instead of the ones they opened.
  expanded: Set<string>
  expandAll: boolean
  playback: Playback
  connected: boolean
  sidebarOpen: boolean
  theme: Theme
  dockOpen: boolean // playback + timeline at the bottom
  panel: SidePanel | null // the right-hand panel: activity feed or cost
  costUnit: 'dollars' | 'tokens'
  costHighlight: string[] // graph cards to highlight while a cost segment is hovered
  focusRequest: { key: string; at: number } | null // a card the graph should centre

  setRuns: (runs: RunInfo[]) => void
  applyUpdate: (event: RunUpdateEvent) => void
  selectRun: (id: string | null, fromUser?: boolean) => void
  setSelectedKey: (key: string | null) => void
  setHoverKey: (key: string | null) => void
  toggleCollapsed: (key: string) => void
  toggleExpanded: (key: string) => void
  toggleExpandAll: () => void
  setPlayback: (p: Partial<Playback>) => void
  setConnected: (c: boolean) => void
  toggleSidebar: () => void
  toggleTheme: () => void
  toggleDock: () => void
  togglePanel: (panel: SidePanel) => void
  setCostUnit: (unit: 'dollars' | 'tokens') => void
  setCostHighlight: (keys: string[]) => void
  focusCard: (key: string) => void
}

export type SidePanel = 'activity' | 'cost'

export type Theme = 'light' | 'dark'

// View preferences survive a reload. Storage can be unavailable (private
// windows, blocked site data), so every access is guarded.
function loadPref<T extends string | boolean>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`loopview.${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function savePref(key: string, value: string | boolean) {
  try {
    localStorage.setItem(`loopview.${key}`, JSON.stringify(value))
  } catch {
    // not persisted; the preference still applies for this visit
  }
}

function loadPanel(): SidePanel | null {
  const saved = loadPref<string>('panel', 'activity')
  return saved === 'activity' || saved === 'cost' ? saved : null
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

function toLoaded(run: RunInfo, steps: Map<string, Step>, transitions: Transition[], version: number): LoadedRun {
  const stepList = [...steps.values()].sort((a, b) => a.start_ns - b.start_ns || a.id.localeCompare(b.id))
  return { run, steps, transitions, version, view: { run, steps: stepList, transitions } }
}

export const useStore = create<State>((set, get) => ({
  runs: new Map(),
  loaded: new Map(),
  selectedRunId: null,
  followLive: true,
  selectedKey: null,
  hoverKey: null,
  collapsed: new Set(),
  expanded: new Set(),
  expandAll: false,
  playback: { time: LIVE, playing: false, speed: 1 },
  connected: false,
  sidebarOpen: true,
  theme: loadPref<Theme>('theme', 'light'),
  dockOpen: loadPref('dockOpen', false),
  panel: loadPanel(),
  costUnit: loadPref<'dollars' | 'tokens'>('costUnit', 'dollars'),
  costHighlight: [],
  focusRequest: null,

  setRuns: (list) => {
    const runs = new Map(list.map((r) => [r.id, r]))
    set({ runs })
    const { selectedRunId } = get()
    if ((!selectedRunId || !runs.has(selectedRunId)) && list.length > 0) get().selectRun(list[0].id)
  },

  applyUpdate: (event) => {
    const { runs, loaded, selectedRunId, followLive, playback } = get()
    const isNew = !runs.has(event.run.id)
    const nextRuns = new Map(runs)
    nextRuns.set(event.run.id, event.run)
    const current = loaded.get(event.run.id)
    if (current) {
      const steps = new Map(current.steps)
      for (const step of event.steps) steps.set(step.id, step)
      const nextLoaded = new Map(loaded)
      nextLoaded.set(event.run.id, toLoaded(event.run, steps, event.transitions, current.version + 1))
      set({ runs: nextRuns, loaded: nextLoaded })
    } else {
      set({ runs: nextRuns })
    }
    const replaying = playback.time !== LIVE
    if ((isNew && followLive && !replaying) || !selectedRunId) get().selectRun(event.run.id)
  },

  selectRun: (id, fromUser = false) => {
    set({
      selectedRunId: id,
      selectedKey: null,
      hoverKey: null,
      playback: { ...get().playback, time: LIVE, playing: false },
      ...(fromUser ? { followLive: false } : {}),
    })
    if (id && !get().loaded.has(id)) {
      api.run(id).then((n) => {
        const loaded = new Map(get().loaded)
        const existing = loaded.get(id)
        // Keep any live updates that arrived while fetching.
        const steps = new Map(n.steps.map((s) => [s.id, s]))
        if (existing) for (const [k, v] of existing.steps) steps.set(k, v)
        loaded.set(id, toLoaded(existing?.run ?? n.run, steps, existing?.transitions ?? n.transitions, 1))
        set({ loaded })
      })
    }
  },

  setSelectedKey: (key) => set({ selectedKey: key }),
  setHoverKey: (key) => set({ hoverKey: key }),
  toggleCollapsed: (key) => {
    const collapsed = new Set(get().collapsed)
    if (collapsed.has(key)) collapsed.delete(key)
    else collapsed.add(key)
    set({ collapsed })
  },
  toggleExpanded: (key) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(key)) expanded.delete(key)
    else expanded.add(key)
    set({ expanded })
  },
  toggleExpandAll: () => set({ expandAll: !get().expandAll, expanded: new Set() }),
  setPlayback: (p) => set({ playback: { ...get().playback, ...p } }),
  setConnected: (connected) => set({ connected }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  toggleTheme: () => {
    const theme: Theme = get().theme === 'light' ? 'dark' : 'light'
    applyTheme(theme)
    savePref('theme', theme)
    set({ theme })
  },
  toggleDock: () => {
    savePref('dockOpen', !get().dockOpen)
    set({ dockOpen: !get().dockOpen })
  },
  // Open a panel, or close it when it is the one already open.
  togglePanel: (panel) => {
    const next = get().panel === panel ? null : panel
    savePref('panel', next ?? 'none')
    set({ panel: next })
  },
  setCostUnit: (costUnit) => {
    savePref('costUnit', costUnit)
    set({ costUnit })
  },
  setCostHighlight: (costHighlight) => set({ costHighlight }),
  focusCard: (key) => set({ focusRequest: { key, at: Date.now() } }),
}))

export function isExpanded(state: { expanded: Set<string>; expandAll: boolean }, key: string) {
  return state.expandAll !== state.expanded.has(key)
}

export const useSelectedRun = () => useStore((s) => (s.selectedRunId ? s.loaded.get(s.selectedRunId) : undefined))
