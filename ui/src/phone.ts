// Phones, held either way: narrow, or short (sideways). The same line the `phone:`
// classes use (index.css). loopview is built for a computer; on a phone it trims
// itself to the core (pick a run, watch the graph, open a step) rather than becoming
// a fully responsive app.

import { useSyncExternalStore } from 'react'

const PHONE = '(max-width: 767px), (max-height: 500px)'
// Taller than wide (a phone held upright, a tablet, a narrow window): the graph
// then flows top to bottom instead of left to right.
const PORTRAIT = '(orientation: portrait)'

const media = (query: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null)

const matches = (query: string) => media(query)?.matches ?? false

// One subscribe function per query, so React doesn't resubscribe on every render.
const subscribers = new Map<string, (onChange: () => void) => () => void>()

function subscriber(query: string) {
  let subscribe = subscribers.get(query)
  if (!subscribe) {
    subscribe = (onChange) => {
      const m = media(query)
      m?.addEventListener('change', onChange)
      return () => m?.removeEventListener('change', onChange)
    }
    subscribers.set(query, subscribe)
  }
  return subscribe
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(subscriber(query), () => matches(query), () => false)
}

export const isPhone = () => matches(PHONE)
export const useIsPhone = () => useMedia(PHONE)
export const useIsPortrait = () => useMedia(PORTRAIT)
