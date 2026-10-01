// A small collapsible JSON viewer with syntax colours. No dependency: the data
// is already parsed, so rendering is a short recursive component.

import { useState } from 'react'
import { Chevron } from '../icons'
import { CopyButton } from './CopyButton'

export function JsonBlock({ value, label, open = false }: { value: unknown; label?: string; open?: boolean }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div className="group/json relative rounded-lg border border-border bg-canvas/60">
      {label && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted">
          {label}
          <CopyButton text={text} />
        </div>
      )}
      <div className="max-h-80 overflow-auto px-3 py-2 font-mono text-[12px] leading-5">
        {typeof value === 'string' ? (
          <span className="whitespace-pre-wrap break-words text-json-string">{value}</span>
        ) : (
          <JsonNode value={value} depth={0} open={open} />
        )}
      </div>
    </div>
  )
}

function JsonNode({ value, depth, open, name }: { value: unknown; depth: number; open: boolean; name?: string }) {
  const [expanded, setExpanded] = useState(open || depth < 1)
  const key = name !== undefined && <span className="text-json-key">{JSON.stringify(name)}: </span>

  if (value === null || typeof value !== 'object') {
    return (
      <div className="pl-4">
        {key}
        <Scalar value={value} />
      </div>
    )
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const [openBrace, closeBrace] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  if (entries.length === 0) {
    return (
      <div className="pl-4">
        {key}
        <span className="text-muted">{openBrace + closeBrace}</span>
      </div>
    )
  }
  return (
    <div className={depth === 0 ? '' : 'pl-4'}>
      <button className="-ml-4 inline-flex items-center text-left hover:text-text" onClick={() => setExpanded(!expanded)}>
        <Chevron size={12} className={`mr-0.5 text-muted transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        {key}
        <span className="text-muted">{openBrace}</span>
        {!expanded && (
          <span className="text-muted">
            {' '}
            {entries.length} {Array.isArray(value) ? 'items' : 'keys'} {closeBrace}
          </span>
        )}
      </button>
      {expanded && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={Array.isArray(value) ? undefined : k} value={v} depth={depth + 1} open={open} />
          ))}
          <div className="text-muted">{closeBrace}</div>
        </>
      )}
    </div>
  )
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="break-words text-json-string">{JSON.stringify(value)}</span>
  if (typeof value === 'number') return <span className="text-json-number">{value}</span>
  if (typeof value === 'boolean') return <span className="text-json-bool">{String(value)}</span>
  return <span className="text-muted">null</span>
}
