// The centrepiece: the run drawn as a graph that builds itself and moves.

import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGraph, collapseGraph } from '../../graph/buildGraph'
import { computeLayout, type Layout } from '../../graph/layout'
import { useSelectedRun, useStore } from '../../store'
import { hueMap, NEUTRAL_HUE } from '../../theme'
import { FlowEdge, type FlowFlowEdge } from './FlowEdge'
import { GroupNode, type GroupFlowNode } from './GroupNode'
import { StepNode, type StepFlowNode } from './StepNode'

const nodeTypes = { step: StepNode, group: GroupNode }
const edgeTypes = { flow: FlowEdge }

export function GraphView() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const collapsed = useStore((s) => s.collapsed)
  const hoverKey = useStore((s) => s.hoverKey)
  const selectedKey = useStore((s) => s.selectedKey)
  const { setSelectedKey, setHoverKey, toggleCollapsed } = useStore.getState()
  const { fitBounds } = useReactFlow()

  const fullGraph = useMemo(() => (loaded ? buildGraph(loaded.view, time) : null), [loaded, time])
  const graph = useMemo(() => (fullGraph ? collapseGraph(fullGraph, collapsed) : null), [fullGraph, collapsed])
  // Hues come from the full run, so an agent keeps its colour through replay.
  const hues = useMemo(() => {
    const all = loaded ? buildGraph(loaded.view) : null
    return hueMap(all ? all.nodes.map((n) => n.agentKey) : [])
  }, [loaded])

  // Layout reruns only when the structure changes, not on status changes.
  const [layout, setLayout] = useState<Layout | null>(null)
  const graphRef = useRef(graph)
  graphRef.current = graph
  const structureKey = graph?.structureKey
  useEffect(() => {
    const current = graphRef.current
    if (!current || current.nodes.length === 0) {
      setLayout(null)
      return
    }
    let cancelled = false
    computeLayout(current).then((result) => {
      if (!cancelled) setLayout(result)
    })
    return () => {
      cancelled = true
    }
  }, [structureKey])

  // Keep the whole graph in view as it grows. Fit to the bounds ELK computed
  // rather than to measured nodes: right after a layout, React Flow has not
  // measured new nodes yet, and fitView would frame the old graph.
  const runId = loaded?.run.id
  useEffect(() => {
    if (!layout || !graphRef.current) return
    const topLevel = graphRef.current.nodes.filter((n) => !n.groupKey).map((n) => layout.boxes.get(n.key))
    const boxes = topLevel.filter((b) => b !== undefined)
    if (boxes.length === 0) return
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    const width = Math.max(...boxes.map((b) => b.x + b.width)) - x
    const height = Math.max(...boxes.map((b) => b.y + b.height)) - y
    // Frame at least a minimum area, so a one-node graph isn't blown up.
    const w = Math.max(width, 760)
    const h = Math.max(height, 420)
    fitBounds({ x: x - (w - width) / 2, y: y - (h - height) / 2, width: w, height: h }, { duration: 400, padding: 0.12 })
  }, [layout, runId, fitBounds])

  const { nodes, edges } = useMemo(() => {
    if (!graph || !layout) return { nodes: [] as Node[], edges: [] as Edge[] }
    const flowNodes: (StepFlowNode | GroupFlowNode)[] = []
    const sorted = [...graph.nodes].sort((a, b) => a.depth - b.depth)
    const byKey = new Map(graph.nodes.map((n) => [n.key, n]))
    for (const node of sorted) {
      const box = layout.boxes.get(node.key)
      if (!box) continue // appeared after the last layout; placed on the next one
      if (node.groupKey && !layout.boxes.has(node.groupKey)) continue
      const hue = (node.agentKey && hues.get(node.agentKey)) || NEUTRAL_HUE
      const isGroup = node.kind === 'agent' && !node.collapsed && graph.nodes.some((n) => n.groupKey === node.key)
      const common = {
        id: node.key,
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        style: { width: box.width, height: box.height },
        parentId: node.groupKey && byKey.has(node.groupKey) ? node.groupKey : undefined,
        draggable: false,
        selectable: false,
      }
      const data = {
        node,
        hue,
        highlighted: hoverKey === node.key,
        selected: selectedKey === node.key,
        onToggle: () => toggleCollapsed(node.key),
      }
      flowNodes.push(
        isGroup
          ? { ...common, type: 'group', data, zIndex: -1 }
          : { ...common, type: 'step', data },
      )
    }
    const running = new Set(graph.nodes.filter((n) => n.status === 'running').map((n) => n.key))
    const flowEdges: FlowFlowEdge[] = graph.edges.map((e) => {
      const target = byKey.get(e.target)
      const hue = (target?.agentKey && hues.get(target.agentKey)) || NEUTRAL_HUE
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'flow',
        zIndex: 1,
        data: { edge: e, route: layout.routes.get(e.id), hue, active: running.has(e.target) },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: e.kind === 'loop' ? '#71717a' : '#52525b' },
      }
    })
    return { nodes: flowNodes as Node[], edges: flowEdges as Edge[] }
  }, [graph, layout, hues, hoverKey, selectedKey, toggleCollapsed])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, n) => setSelectedKey(n.id === selectedKey ? null : n.id)}
      onNodeMouseEnter={(_, n) => setHoverKey(n.id)}
      onNodeMouseLeave={() => setHoverKey(null)}
      onPaneClick={() => setSelectedKey(null)}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--color-canvas-dot)" />
    </ReactFlow>
  )
}
