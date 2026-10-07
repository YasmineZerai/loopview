// Only in the hosted demo: the guided tour's state, the description of each
// example, and the replay that starts by itself once the visitor is free to look.

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { demoCatalog, STATIC_DEMO, type DemoAbout } from '../../api'
import { useSelectedRun, useStore } from '../../store'
import { togglePlay } from '../PlaybackBar'

interface DemoState {
  tourStep: number | null // null: no tour on screen
  aboutOpen: boolean
  startTour: () => void
  setTourStep: (step: number) => void
  endTour: () => void
  setAboutOpen: (open: boolean) => void
}

export const useDemo = create<DemoState>((set) => ({
  // The tour is the first thing every visit shows; the Tour button brings it back.
  tourStep: STATIC_DEMO ? 0 : null,
  aboutOpen: false, // folded into a button until asked for, so the graph has the room
  startTour: () => set({ tourStep: 0 }),
  setTourStep: (tourStep) => set({ tourStep }),
  endTour: () => set({ tourStep: null }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
}))

let catalog: Promise<Map<string, DemoAbout>> | null = null

/** The demo's description of a run, once the index has loaded. */
export function useDemoCatalog(): Map<string, DemoAbout> {
  const [value, setValue] = useState<Map<string, DemoAbout>>(new Map())
  useEffect(() => {
    if (!STATIC_DEMO) return
    catalog ??= demoCatalog()
    let cancelled = false
    catalog.then((c) => !cancelled && setValue(c)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return value
}

/** Start replaying the first run shortly after it loads, unless the tour is open:
 * then the replay starts when the tour ends, so it isn't over before anyone looks. */
export function useDemoAutoplay() {
  const loaded = useSelectedRun()
  const touring = useDemo((s) => s.tourStep !== null)
  const started = useRef(false)
  useEffect(() => {
    if (!STATIC_DEMO || started.current || !loaded || touring) return
    const timer = setTimeout(() => {
      started.current = true
      if (!useStore.getState().playback.playing) togglePlay()
    }, 900)
    return () => clearTimeout(timer)
  }, [loaded, touring])
}
