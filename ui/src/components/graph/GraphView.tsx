// The centrepiece: the run drawn as a graph that builds itself and moves.

import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  useReactFlow,
  useUpdateNodeInternals,
  type Edge,
  type Node,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activeCardKeys } from '../../graph/activity'
import { buildGraph, collapseGraph } from '../../graph/buildGraph'
import { computeLayout, hasCalls, type Direction, type Layout } from '../../graph/layout'
import { isExpanded, useSelectedRun, useStore } from '../../store'
import { hueMap, NEUTRAL_HUE } from '../../theme'
import type { Step } from '../../types'
import { isPhone, useIsPortrait } from '../../phone'
import { orderCalls } from '../CallViews'
import { FlowEdge, type FlowFlowEdge } from './FlowEdge'
import { GroupNode, type GroupFlowNode } from './GroupNode'
import { StepNode, type StepFlowNode } from './StepNode'

const nodeTypes = { step: StepNode, group: GroupNode }
const NO_CALLS: Step[] = []
const edgeTypes = { flow: FlowEdge }
// How long after a focus request new layouts still re-centre on the card.
const FOCUS_WINDOW_MS = 2000
// Following the activity frames the active cards in at least this much of the
// graph (in graph units), so one small card isn't blown up.
const FOLLOW_MIN_WIDTH = 1000
const FOLLOW_MIN_HEIGHT = 600
const NO_KEYS = new Set<string>()

/** A node's size: as React Flow measured it, or else as the layout gave it (a node
 * re-created during a replay can stay unmeasured for a while). */
function sizeOf(node: { measured: { width?: number; height?: number }; width?: number; height?: number }) {
  return { width: node.measured.width ?? node.width ?? 0, height: node.measured.height ?? node.height ?? 0 }
}

export function GraphView() {
  const loaded = useSelectedRun()
  const time = useStore((s) => s.playback.time)
  const collapsed = useStore((s) => s.collapsed)
  const hoverKey = useStore((s) => s.hoverKey)
  const selectedKey = useStore((s) => s.selectedKey)
  const theme = useStore((s) => s.theme)
  const focusRequest = useStore((s) => s.focusRequest)
  const { setSelectedKey, setHoverKey, toggleCollapsed, toggleExpanded, focusCard } = useStore.getState()
  const { fitBounds, getInternalNode, getZoom, setCenter } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  // On a portrait screen the graph flows top to bottom.
  const direction: Direction = useIsPortrait() ? 'DOWN' : 'RIGHT'

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

  // Activity: the cards where something is happening, live and in replay. They open,
  // and close again when their calls are done; the camera frames them (below). Kept
  // as a string too, so the set only changes when its cards do, not on every tick.
  const activity = useStore((s) => s.activity)
  const activeSig = useMemo(() => (activity && loaded ? [...activeCardKeys(loaded.view, time)].sort().join('\n') : ''), [activity, loaded, time])
  const activeKeys = useMemo(() => (activeSig ? new Set(activeSig.split('\n')) : NO_KEYS), [activeSig])
  // Active cards the user closed by hand: they stay closed while they are active.
  const [closedActive, setClosedActive] = useState<{ sig: string; keys: Set<string> }>({ sig: '', keys: NO_KEYS })
  const closedNow = closedActive.sig === activeSig ? closedActive.keys : NO_KEYS

  // Which cards are expanded right now (only cards, and only ones with calls).
  const expandedState = useStore((s) => s.expanded)
  const expandAll = useStore((s) => s.expandAll)
  const expanded = useMemo(() => {
    const keys = new Set<string>()
    for (const node of graph?.nodes ?? []) {
      const isCard = node.kind !== 'agent' || node.collapsed || !graph!.nodes.some((n) => n.groupKey === node.key)
      const open = isExpanded({ expanded: expandedState, expandAll }, node.key, activeKeys) && !closedNow.has(node.key)
      if (isCard && hasCalls(node) && open) keys.add(node.key)
    }
    return keys
  }, [graph, expandedState, expandAll, activeKeys, closedNow])

  /** The › on a card. A card open only because it is active closes while it stays active. */
  const onExpand = useCallback(
    (key: string) => {
      const byActivity = !expandAll && activeKeys.has(key) && !expandedState.has(key)
      if (!byActivity) return toggleExpanded(key)
      const keys = new Set(closedNow)
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      setClosedActive({ sig: activeSig, keys })
    },
    [expandAll, activeKeys, expandedState, closedNow, activeSig, toggleExpanded],
  )

  // Layout reruns only when the structure (or which cards are expanded) changes,
  // not on status changes.
  const [layout, setLayout] = useState<Layout | null>(null)
  const graphRef = useRef(graph)
  graphRef.current = graph
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const layoutKey = graph ? `${graph.structureKey}#${[...expanded].sort().join(',')}#${direction}` : undefined
  useEffect(() => {
    const current = graphRef.current
    if (!current || current.nodes.length === 0) {
      setLayout(null)
      return
    }
    let cancelled = false
    computeLayout(current, expandedRef.current, direction).then((result) => {
      if (!cancelled) setLayout(result)
    })
    return () => {
      cancelled = true
    }
  }, [layoutKey, direction])

  // The handles move from the sides to the top and bottom when the direction
  // flips; React Flow measures them again only when asked.
  const layoutDirection = layout?.direction
  useEffect(() => {
    const ids = graphRef.current?.nodes.map((n) => n.key)
    if (layoutDirection && ids?.length) requestAnimationFrame(() => updateNodeInternals(ids))
  }, [layoutDirection, updateNodeInternals])

  // Keep the whole graph in view as it grows. Fit to the bounds ELK computed
  // rather than to measured nodes: right after a layout, React Flow has not
  // measured new nodes yet, and fitView would frame the old graph.
  const runId = loaded?.run.id
  const bounds = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  // With Activity on the camera follows the active card, so the whole graph is
  // framed once per run instead of after every layout.
  const fittedRun = useRef<string | undefined>(undefined)
  const activityRef = useRef(activity)
  activityRef.current = activity
  useEffect(() => {
    if (!layout || !graphRef.current) return
    if (activityRef.current && fittedRun.current === runId) return
    const topLevel = graphRef.current.nodes.filter((n) => !n.groupKey).map((n) => layout.boxes.get(n.key))
    const boxes = topLevel.filter((b) => b !== undefined)
    if (boxes.length === 0) return
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    const width = Math.max(...boxes.map((b) => b.x + b.width)) - x
    const height = Math.max(...boxes.map((b) => b.y + b.height)) - y
    // Frame at least a minimum area, so a one-node graph isn't blown up; tall, when
    // the graph flows down.
    const down = layout.direction === 'DOWN'
    const w = Math.max(width, down ? 420 : 760)
    const h = Math.max(height, down ? 760 : 420)
    bounds.current = { x: x - (w - width) / 2, y: y - (h - height) / 2, width: w, height: h }
    fitBounds(bounds.current, { duration: 400, padding: 0.12 })
    fittedRun.current = runId
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

  // Centre a card when another panel asks (a row in the Cost or Tools tab). React
  // Flow knows each node's absolute place, including cards inside agent groups. The
  // details panel opens over the right of the canvas, so aim left of centre.
  // The request can come with a run that isn't laid out yet (the Tools tab opens
  // another run), and opening the card changes the layout, so it is retried on
  // each new layout for a short while, once React Flow has measured the card.
  useEffect(() => {
    if (!focusRequest || Date.now() - focusRequest.at > FOCUS_WINDOW_MS) return
    let frame = 0
    let tries = 0
    const attempt = () => {
      const node = getInternalNode(focusRequest.key)
      if (!node || !sizeOf(node).width) {
        if (tries++ < 30) frame = requestAnimationFrame(attempt)
        return
      }
      const { x, y } = node.internals.positionAbsolute
      const { width, height } = sizeOf(node)
      // On a phone the details panel covers the whole canvas, so there is nothing to
      // aim beside, and the card is zoomed only as far as the screen's width allows.
      const phone = isPhone()
      const zoom = phone ? Math.min(Math.max(getZoom(), 0.9), (window.innerWidth - 32) / width) : Math.max(getZoom(), 0.9)
      const panel = phone ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--details-width')) || 0
      setCenter(x + width / 2 + panel / 2 / zoom, y + height / 2, { zoom, duration: 400 })
    }
    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, layout, getInternalNode, getZoom, setCenter])

  // Activity: the camera zooms in on the active cards, live and in replay. It moves
  // when they change or the layout moves them, never otherwise, so panning around
  // stays possible while nothing new happens. A zoom the user picked by hand is kept
  // (for this run, while Activity stays on); until then it frames the active cards.
  // While a card is selected (its details open), the user is reading: no following.
  const view = useStore((s) => s.view)
  const userZoom = useRef<number | null>(null)
  const moveStartZoom = useRef(0)
  useEffect(() => {
    userZoom.current = null
  }, [runId, activity])
  useEffect(() => {
    if (activeKeys.size === 0 || view !== 'graph' || selectedKey) return
    // A card another tab asked to show (a jump from Tools or Cost) wins for a moment.
    const request = useStore.getState().focusRequest
    if (request && Date.now() - request.at < FOCUS_WINDOW_MS) return
    let frame = 0
    let tries = 0
    const follow = () => {
      const nodes = [...activeKeys].map((key) => getInternalNode(key)).filter((n) => n !== undefined)
      if (nodes.length === 0 || nodes.some((n) => !sizeOf(n).width)) {
        if (tries++ < 30) frame = requestAnimationFrame(follow)
        return
      }
      const left = Math.min(...nodes.map((n) => n.internals.positionAbsolute.x))
      const top = Math.min(...nodes.map((n) => n.internals.positionAbsolute.y))
      const right = Math.max(...nodes.map((n) => n.internals.positionAbsolute.x + sizeOf(n).width))
      const bottom = Math.max(...nodes.map((n) => n.internals.positionAbsolute.y + sizeOf(n).height))
      const cx = (left + right) / 2
      const cy = (top + bottom) / 2
      if (userZoom.current) {
        setCenter(cx, cy, { zoom: userZoom.current, duration: 500 })
        return
      }
      const down = layout?.direction === 'DOWN'
      const w = Math.max(right - left, down ? FOLLOW_MIN_HEIGHT : FOLLOW_MIN_WIDTH)
      const h = Math.max(bottom - top, down ? FOLLOW_MIN_WIDTH : FOLLOW_MIN_HEIGHT)
      fitBounds({ x: cx - w / 2, y: cy - h / 2, width: w, height: h }, { padding: 0.06, duration: 500 })
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [activeKeys, layout, view, selectedKey, getInternalNode, setCenter, fitBounds])

  /** Clicking a node selects it (its details open) and zooms in on it. */
  const onNodeClick = (key: string, isGroup: boolean) => {
    if (key === selectedKey) return setSelectedKey(null)
    setSelectedKey(key)
    const node = getInternalNode(key)
    if (isGroup && node && sizeOf(node).width) {
      const { x, y } = node.internals.positionAbsolute
      fitBounds({ x, y, ...sizeOf(node) }, { padding: 0.1, duration: 400 })
    } else focusCard(key)
  }

  const { nodes, edges } = useMemo(() => {
    if (!graph || !layout) return { nodes: [] as Node[], edges: [] as Edge[] }
    const flowNodes: (StepFlowNode | GroupFlowNode)[] = []
    // From the layout drawn, not the screen: right after a rotation the old layout
    // shows until the new one is ready.
    const vertical = layout.direction === 'DOWN'
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
        vertical,
        highlighted: hoverKey === node.key || activeKeys.has(node.key),
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
          onExpand: () => onExpand(node.key),
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
        data: { edge: e, route: layout.routes.get(e.id), hue, active: running.has(e.target), vertical },
        // Marker colours are SVG attributes, so they can't use CSS variables.
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: theme === 'dark' ? '#52525b' : '#a1a1aa' },
      }
    })
    return { nodes: flowNodes as Node[], edges: flowEdges as Edge[] }
  }, [graph, layout, hues, hoverKey, activeKeys, selectedKey, toggleCollapsed, theme, expanded, callsByNode, time, onExpand])

  return (
    <div ref={container} className="h-full w-full">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, n) => onNodeClick(n.id, n.type === 'group')}
      // A zoom by hand (wheel, pinch) is kept while following the activity.
      onMoveStart={(event, viewport) => {
        if (event) moveStartZoom.current = viewport.zoom
      }}
      onMoveEnd={(event, viewport) => {
        if (event && Math.abs(viewport.zoom - moveStartZoom.current) > 0.01) userZoom.current = viewport.zoom
      }}
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
