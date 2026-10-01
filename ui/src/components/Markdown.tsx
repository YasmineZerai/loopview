// Just enough Markdown for model replies: headings, bullets, numbered lists,
// tables, **bold**, `code`. Builds React elements (never raw HTML), so model
// output can't inject markup.

import type { ReactNode } from 'react'

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let table: string[] = []

  const flushTable = () => {
    if (table.length === 0) return
    blocks.push(<Table key={`t${blocks.length}`} rows={table} />)
    table = []
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    if (line.trim().startsWith('|')) {
      table.push(line.trim())
      return
    }
    flushTable()
    if (line.trim() === '') {
      blocks.push(<div key={i} className="h-1.5" />)
      return
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      blocks.push(
        <p key={i} className="font-semibold">
          {inline(heading[1])}
        </p>,
      )
      return
    }
    const bullet = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)$/)
    if (bullet) {
      const indent = Math.min(3, Math.floor(bullet[1].length / 2))
      const marker = /\d/.test(bullet[2]) ? bullet[2] : '•'
      blocks.push(
        <p key={i} className="flex gap-1.5" style={{ paddingLeft: indent * 12 }}>
          <span className="shrink-0 text-muted">{marker}</span>
          <span className="min-w-0">{inline(bullet[3])}</span>
        </p>,
      )
      return
    }
    blocks.push(<p key={i}>{inline(line)}</p>)
  })
  flushTable()
  return <div className={`space-y-0.5 break-words leading-relaxed ${className}`}>{blocks}</div>
}

function Table({ rows }: { rows: string[] }) {
  const cells = rows
    .filter((r) => !/^\|[\s:|-]+\|$/.test(r)) // drop the |---|---| separator row
    .map((r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
  const [head, ...body] = cells
  return (
    <div className="my-1 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr>
            {head?.map((c, i) => (
              <th key={i} className="border-b border-border px-1.5 py-0.5 text-left font-semibold">
                {inline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((c, i) => (
                <td key={i} className="border-b border-border/60 px-1.5 py-0.5 align-top">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** **bold** and `code` inside a line. */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="rounded bg-overlay px-1 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}
