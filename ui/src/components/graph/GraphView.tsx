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
import { computeLayout, hasCalls, type Layout } from '../../graph/layout'
import { isExpanded, useSelectedRun, useStore } from '../../store'
import { hueMap, NEUTRAL_HUE } from '../../theme'
import type { Step } from '../../types'
import { orderCalls } from '../CallViews'
import { FlowEdge, type FlowFlowEdge } from './FlowEdge'
import { GroupNode, type GroupFlowNode } from './GroupNode'
import { StepNode, type StepFlowNode } from './StepNode'

const nodeTypes = { step: StepNode, group: GroupNode }
const NO_CALLS: Step[] = []
const edgeTypes = { flow: FlowEdge }

export function GraphView() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const collapsed = useStore((s) => s.collapsed)
  const hoverKey = useStore((s) => s.hoverKey)
  const selectedKey = useStore((s) => s.selectedKey)
  const theme = useStore((s) => s.theme)
  const costHighlight = useStore((s) => s.costHighlight)
  const focusRequest = useStore((s) => s.focusRequest)
  const { setSelectedKey, setHoverKey, toggleCollapsed, toggleExpanded } = useStore.getState()
  const { fitBounds, getInternalNode, getZoom, setCenter } = useReactFlow()

  const fullGraph = useMemo(() => (loaded ? buildGraph(loaded.view, time) : null), [loaded, time])
  const graph = useMemo(() => (fullGraph ? collapseGraph(fullGraph, collapsed) : null), [fullGraph, collapsed])
  // Hues come from the full run, so an agent keeps its colour through replay.
  const hues = useMemo(() => {
    const all = loaded ? buildGraph(loaded.view) : null
    return hueMap(all ? all.nodes.map((n) => n.agentKey) : [])
  }, [loaded])

  // Model and tool calls of each graph node, in reading order, for expanded cards.
  const callsByNode = useMemo(() => {
    const map = new Map<string, Step[]>()
    if (!loaded) return map
    const byId = new Map(loaded.view.steps.map((s) => [s.id, s]))
    for (const call of orderCalls(loaded.view.steps)) {
      const scope = call.scope_id ? byId.get(call.scope_id) : undefined
      if (!scope) continue
      const list = map.get(scope.key) ?? []
      list.push(call)
      map.set(scope.key, list)
    }
    return map
  }, [loaded])

  // Which cards are expanded right now (only cards, and only ones with calls).
  const expandedState = useStore((s) => s.expanded)
  const expandAll = useStore((s) => s.expandAll)
  const expanded = useMemo(() => {
    const keys = new Set<string>()
    for (const node of graph?.nodes ?? []) {
      const isCard = node.kind !== 'agent' || node.collapsed || !graph!.nodes.some((n) => n.groupKey === node.key)
      if (isCard && hasCalls(node) && isExpanded({ expanded: expandedState, expandAll }, node.key)) keys.add(node.key)
    }
    return keys
  }, [graph, expandedState, expandAll])

  // Layout reruns only when the structure (or which cards are expanded) changes,
  // not on status changes.
  const [layout, setLayout] = useState<Layout | null>(null)
  const graphRef = useRef(graph)
  graphRef.current = graph
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const layoutKey = graph ? `${graph.structureKey}#${[...expanded].sort().join(',')}` : undefined
  useEffect(() => {
    const current = graphRef.current
    if (!current || current.nodes.length === 0) {
      setLayout(null)
      return
    }
    let cancelled = false
    computeLayout(current, expandedRef.current).then((result) => {
      if (!cancelled) setLayout(result)
    })
    return () => {
      cancelled = true
    }
  }, [layoutKey])

  // Keep the whole graph in view as it grows. Fit to the bounds ELK computed
  // rather than to measured nodes: right after a layout, React Flow has not
  // measured new nodes yet, and fitView would frame the old graph.
  const runId = loaded?.run.id
  const bounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
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
    bounds.current = { x: x - (w - width) / 2, y: y - (h - height) / 2, width: w, height: h }
    fitBounds(bounds.current, { duration: 400, padding: 0.12 })
  }, [layout, runId, fitBounds])

  // Re-frame when the canvas changes size (side panels opening or closing, the
  // timeline dock, the window), or the graph ends up partly hidden.
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = container.current
    if (!el) return
    let timer = 0
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (bounds.current) fitBounds(bounds.current, { duration: 250, padding: 0.12 })
      }, 120)
    })
    observer.observe(el)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [fitBounds])

  // Centre a card when another panel asks (a row in the Cost tab). React Flow
  // knows each node's absolute place, including cards inside agent groups. The
  // details panel opens over the right of the canvas, so aim left of centre.
  useEffect(() => {
    const node = focusRequest && getInternalNode(focusRequest.key)
    if (!node) return
    const zoom = Math.max(getZoom(), 0.9)
    const panel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--details-width')) || 0
    const { x, y } = node.internals.positionAbsolute
    const { width = 0, height = 0 } = node.measured
    setCenter(x + width / 2 + panel / 2 / zoom, y + height / 2, { zoom, duration: 400 })
  }, [focusRequest, getInternalNode, getZoom, setCenter])

  const { nodes, edges } = useMemo(() => {
    const lit = new Set(costHighlight)
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
        costLit: lit.has(node.key),
        selected: selectedKey === node.key,
        onToggle: () => toggleCollapsed(node.key),
      }
      if (isGroup) {
        flowNodes.push({ ...common, type: 'group', data, zIndex: -1 })
        continue
      }
      const isOpen = expanded.has(node.key)
      flowNodes.push({
        ...common,
        type: 'step',
        zIndex: isOpen ? 10 : 0, // above edges and neighbours
        data: {
          ...data,
          expandable: hasCalls(node),
          expanded: isOpen,
          onExpand: () => toggleExpanded(node.key),
          calls: callsByNode.get(node.key) ?? NO_CALLS,
          // Only open cards need the clock; closed ones then skip re-rendering.
          time: isOpen ? time : 0,
        },
      })
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
        // Marker colours are SVG attributes, so they can't use CSS variables.
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: theme === 'dark' ? '#52525b' : '#a1a1aa' },
      }
    })
    return { nodes: flowNodes as Node[], edges: flowEdges as Edge[] }
  }, [graph, layout, hues, hoverKey, costHighlight, selectedKey, toggleCollapsed, toggleExpanded, theme, expanded, callsByNode, time])

  return (
    <div ref={container} className="h-full w-full">
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
      colorMode={theme}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--color-canvas-dot)" />
    </ReactFlow>
    </div>
  )
}
