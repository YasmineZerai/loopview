// A graph node card: name, type, run counter, state, and its tool satellites.

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo, useEffect, useRef, useState } from 'react'
import type { GraphNode, ToolSatellite } from '../../graph/buildGraph'
import { formatTokens } from '../../theme'
import { StatusMark } from '../StatusMark'
import { Plus, Sparkle, Wrench } from '../icons'

export type StepNodeData = {
  node: GraphNode
  hue: string
  highlighted: boolean
  selected: boolean
  onToggle?: () => void
}

export type StepFlowNode = Node<StepNodeData, 'step'>

function StepNodeView({ data }: NodeProps<StepFlowNode>) {
  const { node, hue, highlighted, selected } = data
  const running = node.status === 'running'
  const error = node.status === 'error'
  return (
    <div
      className={[
        'step-card group relative h-full rounded-xl border bg-surface/95 px-3 py-2.5 backdrop-blur',
        running ? 'is-running' : '',
        error ? 'border-state-error/70' : 'border-border',
        selected ? 'ring-2 ring-white/70' : highlighted ? 'ring-2 ring-white/30' : '',
        node.status === 'idle' ? 'opacity-60' : '',
      ].join(' ')}
      style={{ '--hue': hue } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="!invisible" />
      <Handle type="source" position={Position.Right} className="!invisible" />
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: hue }} />

      <div className="flex items-center gap-2">
        <StatusMark status={node.status} />
        <span className="truncate font-mono text-[13px] font-medium text-text">{node.name}</span>
        {node.runCount > 1 && <RunCounter count={node.runCount} />}
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
      {node.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 pl-[18px]">
          {node.tools.map((t) => (
            <ToolPill key={t.name} tool={t} hue={hue} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The ×N counter; bumps when the node runs again. */
function RunCounter({ count }: { count: number }) {
  return (
    <span key={count} className="counter-bump ml-auto rounded-md bg-white/8 px-1.5 font-mono text-[11px] text-text">
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
