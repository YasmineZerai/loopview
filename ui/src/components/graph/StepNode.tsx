// A graph node card: name, type, run counter, state, and its tool satellites.
// Expanded, it also shows its calls inline: thinking, replies, tool arguments
// and results, on the same clock as the graph.

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo, useEffect, useRef, useState } from 'react'
import { LIVE, type GraphNode, type ToolSatellite } from '../../graph/buildGraph'
import { formatDuration, formatTokens } from '../../theme'
import type { Step } from '../../types'
import { CallView, isRunning } from '../CallViews'
import { StatusMark } from '../StatusMark'
import { Chevron, Plus, Sparkle, Wrench } from '../icons'

export type StepNodeData = {
  node: GraphNode
  hue: string
  vertical: boolean // the graph flows top to bottom: handles on top and bottom
  highlighted: boolean
  selected: boolean
  onToggle?: () => void
  expandable: boolean
  expanded: boolean
  onExpand: () => void
  calls: Step[] // this node's model and tool calls, in reading order
  time: number // the replay clock (only passed to expanded cards)
}

export type StepFlowNode = Node<StepNodeData, 'step'>

function StepNodeView({ data }: NodeProps<StepFlowNode>) {
  const { node, hue, highlighted, selected, expanded, vertical } = data
  const running = node.status === 'running'
  const error = node.status === 'error'
  return (
    <div
      className={[
        'step-card group relative flex h-full flex-col rounded-xl border bg-surface/95 px-3 py-2.5 backdrop-blur',
        running ? 'is-running' : '',
        error ? 'border-state-error/70' : 'border-border',
        selected ? 'ring-2 ring-ring/70' : highlighted ? 'ring-2 ring-ring/30' : '',
        node.status === 'idle' ? 'opacity-60' : '',
      ].join(' ')}
      style={{ '--hue': hue } as React.CSSProperties}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="!invisible" />
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="!invisible" />
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: hue }} />

      <div className="flex items-center gap-2">
        <StatusMark status={node.status} />
        <span className="truncate font-mono text-[13px] font-medium text-text">{node.name}</span>
        {node.runCount > 1 && <RunCounter count={node.runCount} />}
        {data.expandable && (
          <button
            className={`nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-overlay-strong hover:text-text ${node.runCount > 1 ? '' : 'ml-auto'}`}
            title={expanded ? 'Hide calls' : 'Show calls: thinking, replies, tool inputs and outputs (e for all)'}
            onClick={(e) => {
              e.stopPropagation()
              data.onExpand()
            }}
          >
            <Chevron size={13} className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 pl-[22px] text-[11px] text-muted">
        <span className="uppercase tracking-wider">{node.inferred ? 'running' : node.typeLabel}</span>
        {node.modelCalls > 0 && (
          <span className="flex items-center gap-1 font-mono">
            <Sparkle size={11} />
            {node.modelCalls}
            {node.tokens > 0 && <span className="text-muted/70">· {formatTokens(node.tokens)} tok</span>}
          </span>
        )}
        {node.collapsed && (
          <button
            className="ml-auto flex items-center gap-1 rounded px-1 text-muted hover:text-text"
            onClick={(e) => {
              e.stopPropagation()
              data.onToggle?.()
            }}
          >
            <Plus size={11} /> expand
          </button>
        )}
      </div>
      {expanded ? (
        <CallsBody calls={data.calls} time={data.time} runCount={node.runCount} />
      ) : (
        node.tools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 pl-[18px]">
            {node.tools.map((t) => (
              <ToolPill key={t.name} tool={t} hue={hue} />
            ))}
          </div>
        )
      )}
    </div>
  )
}

/**
 * The calls of an expanded card. Scrolls inside the card (nowheel: the wheel
 * scrolls the list instead of zooming the graph) and follows the newest call
 * unless the reader scrolled up. Repeated runs of the node get a divider.
 */
function CallsBody({ calls, time, runCount }: { calls: Step[]; time: number; runCount: number }) {
  const now = time === 0 ? LIVE : time
  const visible = now === LIVE ? calls : calls.filter((c) => c.start_ns <= now)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  let lastScope: string | null = null
  let run = 0
  return (
    <div
      ref={scroller}
      className="nowheel nodrag nopan mt-2 min-h-0 flex-1 cursor-auto space-y-2 overflow-y-auto border-t border-border pr-1 pt-2"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {visible.length === 0 && <p className="text-[12px] text-muted">No calls yet.</p>}
      {visible.map((call) => {
        const newRun = call.scope_id !== lastScope
        if (newRun) run += 1
        lastScope = call.scope_id
        const status = isRunning(call, now) ? 'running' : call.status
        return (
          <div key={call.id}>
            {newRun && runCount > 1 && (
              <div className="mb-1.5 flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-muted">
                run {run}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className="rounded-lg bg-overlay-soft p-2">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
                {call.kind === 'model_call' ? 'model' : 'tool'}
                <span className="ml-auto">{call.end_ns !== null && !isRunning(call, now) ? formatDuration(call.end_ns - call.start_ns) : ''}</span>
                <StatusMark status={status} size={10} />
              </div>
              <CallView step={call} time={now} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** The ×N counter; bumps when the node runs again. */
function RunCounter({ count }: { count: number }) {
  return (
    <span key={count} className="counter-bump ml-auto rounded-md bg-overlay-strong px-1.5 font-mono text-[11px] text-text">
      ×{count}
    </span>
  )
}

/** A tool satellite. Flashes whenever its call count changes (live or replay). */
function ToolPill({ tool, hue }: { tool: ToolSatellite; hue: string }) {
  const [flash, setFlash] = useState(0)
  const previous = useRef(tool.calls)
  useEffect(() => {
    if (tool.calls > previous.current) setFlash((f) => f + 1)
    previous.current = tool.calls
  }, [tool.calls])
  const error = tool.lastStatus === 'error'
  return (
    <span
      key={flash}
      className={[
        'tool-pill flex max-w-full min-w-0 items-center gap-1 truncate rounded-full border px-2 py-[1px] font-mono text-[10.5px]',
        flash > 0 ? 'tool-flash' : '',
        tool.running ? 'is-running' : '',
        error ? 'border-state-error/60 text-state-error' : 'border-border text-muted',
      ].join(' ')}
      style={{ '--hue': hue } as React.CSSProperties}
      title={`${tool.name}: ${tool.calls} call${tool.calls > 1 ? 's' : ''}${tool.errors ? `, ${tool.errors} failed` : ''}`}
    >
      <Wrench size={10} />
      {tool.name}
      {tool.calls > 1 && <span className="opacity-70">×{tool.calls}</span>}
      {tool.errors > 0 && !error && <span className="h-1.5 w-1.5 rounded-full bg-state-error" />}
    </span>
  )
}

export const StepNode = memo(StepNodeView)
