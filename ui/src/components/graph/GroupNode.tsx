// An agent drawn as a container holding its own nodes and tools.

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { memo } from 'react'
import type { GraphNode } from '../../graph/buildGraph'
import { StatusMark } from '../StatusMark'
import { Minus } from '../icons'

export type GroupNodeData = {
  node: GraphNode
  hue: string
  highlighted: boolean
  selected: boolean
  onToggle: () => void
}

export type GroupFlowNode = Node<GroupNodeData, 'group'>

function GroupNodeView({ data }: NodeProps<GroupFlowNode>) {
  const { node, hue, selected, highlighted } = data
  const running = node.status === 'running'
  return (
    <div
      className={[
        'agent-group h-full w-full rounded-2xl border',
        running ? 'is-running' : '',
        selected ? 'ring-2 ring-ring/60' : highlighted ? 'ring-2 ring-ring/25' : '',
      ].join(' ')}
      style={{ '--hue': hue } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="!invisible" />
      <Handle type="source" position={Position.Right} className="!invisible" />
      <div className="flex h-10 min-w-0 items-center gap-2 px-3.5">
        <StatusMark status={node.status} size={13} />
        <span className="hue-ink shrink-0 font-mono text-[13px] font-semibold">
          {node.name}
        </span>
        <span className="text-[10.5px] uppercase tracking-wider text-muted">{node.typeLabel}</span>
        {node.runCount > 1 && (
          <span key={node.runCount} className="counter-bump rounded-md bg-overlay-strong px-1.5 font-mono text-[11px]">
            ×{node.runCount}
          </span>
        )}
        {node.tools.length > 0 && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted" title="Tools called by this agent">
            {node.tools.map((t) => t.name).join(' · ')}
          </span>
        )}
        <button
          className="nodrag ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-overlay-strong hover:text-text"
          title="Collapse"
          onClick={(e) => {
            e.stopPropagation()
            data.onToggle()
          }}
        >
          <Minus size={13} />
        </button>
      </div>
    </div>
  )
}

export const GroupNode = memo(GroupNodeView)
