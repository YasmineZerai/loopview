// Replay controls: play/pause, speed, scrubber. A live run shows a LIVE badge.

import { useEffect } from 'react'
import { eventTimes, LIVE } from '../graph/buildGraph'
import { useSelectedRun, useStore } from '../store'
import { formatDuration } from '../theme'
import { ChevronDown, ChevronUp, Pause, Play } from './icons'

const SPEEDS = [0.5, 1, 2]

/**
 * The bottom dock is hidden by default; this small floating control is all that
 * shows. It plays and pauses, tells the time, and opens the dock (or press t).
 */
export function MiniPlayback() {
  const loaded = useSelectedRun()
  const playback = useStore((s) => s.playback)
  const toggleDock = useStore((s) => s.toggleDock)
  if (!loaded) return null
  const { run } = loaded
  const live = run.status === 'running'
  const end = run.end_ns ?? run.start_ns
  const time = playback.time === LIVE ? end : Math.min(playback.time, end)
  return (
    <div data-tour="playback" className="fade-in absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface/95 py-1.5 pl-1.5 pr-2 shadow-lg backdrop-blur">
      <button
        disabled={live}
        onClick={() => togglePlay()}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-inverse text-canvas transition-transform duration-150 hover:scale-105 disabled:opacity-30"
        title="Replay (space)"
      >
        {playback.playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <span className="px-1 font-mono text-[11.5px] text-muted">
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-text">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-state-error" /> LIVE
          </span>
        ) : (
          <>
            <span className="text-text">{formatDuration(time - run.start_ns)}</span> /{' '}
            {formatDuration(Math.max(end - run.start_ns, 1))}
          </>
        )}
      </span>
      <button
        onClick={toggleDock}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] text-muted hover:bg-overlay hover:text-text phone:hidden"
        title="Show the timeline (t)"
      >
        <ChevronUp size={13} /> Timeline
      </button>
    </div>
  )
}

export function PlaybackBar() {
  const loaded = useSelectedRun()
  const playback = useStore((s) => s.playback)
  const setPlayback = useStore((s) => s.setPlayback)
  const toggleDock = useStore((s) => s.toggleDock)

  if (!loaded) return null
  const { run } = loaded
  const live = run.status === 'running'
  const start = run.start_ns
  const end = run.end_ns ?? start
  const duration = Math.max(end - start, 1)
  const time = playback.time === LIVE ? end : playback.time

  return (
    <div data-tour="playback" className="flex h-12 items-center gap-3 px-4">
      <button
        disabled={live}
        onClick={() => togglePlay()}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-inverse text-canvas transition-transform duration-150 hover:scale-105 disabled:opacity-30"
        title="Play / pause (space)"
      >
        {playback.playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex rounded-lg border border-border p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setPlayback({ speed: s })}
            className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors duration-150 ${playback.speed === s ? 'bg-overlay-strong text-text' : 'text-muted hover:text-text'}`}
          >
            {s}x
          </button>
        ))}
      </div>
      <input
        type="range"
        className="scrubber flex-1"
        min={0}
        max={duration}
        step={duration / 1000}
        value={live ? duration : time - start}
        disabled={live}
        onChange={(e) => setPlayback({ time: start + Number(e.target.value), playing: false })}
      />
      <span className="w-28 text-right font-mono text-[12px] text-muted">
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-text">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-state-error" /> LIVE
          </span>
        ) : (
          <>
            <span className="text-text">{formatDuration(time - start)}</span> / {formatDuration(duration)}
          </>
        )}
      </span>
      <button
        onClick={toggleDock}
        className="rounded-md p-1.5 text-muted hover:bg-overlay hover:text-text"
        title="Hide the timeline (t)"
      >
        <ChevronDown size={15} />
      </button>
    </div>
  )
}

/** Start or pause replay. Starting from the end (or from LIVE) rewinds first. */
export function togglePlay() {
  const { playback, setPlayback, selectedRunId, loaded } = useStore.getState()
  const run = selectedRunId ? loaded.get(selectedRunId)?.run : undefined
  if (!run || run.status === 'running' || run.end_ns === null) return
  if (playback.playing) return setPlayback({ playing: false })
  const atEnd = playback.time === LIVE || playback.time >= run.end_ns
  setPlayback({ playing: true, time: atEnd ? run.start_ns : playback.time })
}

/** Jump to the previous or next moment where something starts or ends. */
export function stepEvent(direction: 1 | -1) {
  const { playback, setPlayback, selectedRunId, loaded } = useStore.getState()
  const current = selectedRunId ? loaded.get(selectedRunId) : undefined
  if (!current || current.run.end_ns === null) return
  const times = eventTimes(current.view)
  const now = playback.time === LIVE ? current.run.end_ns : playback.time
  const next = direction === 1 ? times.find((t) => t > now + 1) : [...times].reverse().find((t) => t < now - 1)
  if (next !== undefined) setPlayback({ time: next, playing: false })
}

/** Advance the replay clock on every animation frame while playing. Mounted
 * once by the app, so replay keeps running when the dock is hidden. */
export function usePlaybackClock() {
  const playing = useStore((s) => s.playback.playing)
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const { playback, setPlayback, selectedRunId, loaded } = useStore.getState()
      const run = selectedRunId ? loaded.get(selectedRunId)?.run : undefined
      if (!run || run.end_ns === null) return
      const next = playback.time + (now - last) * 1e6 * playback.speed
      last = now
      if (next >= run.end_ns) {
        setPlayback({ time: LIVE, playing: false })
        return
      }
      setPlayback({ time: next })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])
}
