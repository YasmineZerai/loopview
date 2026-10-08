// Only in the hosted demo, only on a phone: loopview is built for a computer, so say
// so once, with a way to send the link to one. Dismissed for good on this browser.

import { useState } from 'react'
import { Cross } from '../icons'
import { useDemo } from './demoState'

const KEY = 'loopview.phoneNoteDismissed'

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function PhoneNote() {
  const touring = useDemo((s) => s.tourStep !== null)
  const [hidden, setHidden] = useState(dismissed)
  const [copied, setCopied] = useState(false)
  if (hidden || touring) return null

  const close = () => {
    setHidden(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // private mode: it comes back next visit, which is fine
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // no clipboard (an in-app browser): the share sheet, where there is one
      navigator.share?.({ title: 'loopview demo', url: window.location.href }).catch(() => {})
    }
  }

  return (
    <div className="fade-in flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 text-[12px] leading-snug text-muted">
      <span className="min-w-0 flex-1">
        loopview is built for a computer. <span className="text-text">This is a preview.</span>
      </span>
      <button className="shrink-0 rounded-md border border-border px-2 py-1 text-[11.5px] text-text hover:bg-overlay" onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <button className="-mr-1 shrink-0 rounded-md p-1.5 hover:bg-overlay hover:text-text" onClick={close} aria-label="Dismiss">
        <Cross size={14} />
      </button>
    </div>
  )
}
