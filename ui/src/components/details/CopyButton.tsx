import { useState } from 'react'
import { Check, Copy } from '../icons'

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] normal-case tracking-normal text-muted hover:bg-overlay-strong hover:text-text ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title="Copy"
    >
      {copied ? <Check size={12} className="text-state-ok" /> : <Copy size={12} />}
      {copied ? 'copied' : 'copy'}
    </button>
  )
}
