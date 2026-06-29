import { useEffect, useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSessionStore } from '@/stores/session-store'
import { SessionNode } from './SessionNode'
import FlowEdge from './FlowEdge'
import { CanvasContextMenu } from './CanvasContextMenu'
import { Loader2, ServerOff, LayoutGrid } from 'lucide-react'
import { toastError } from '@/lib/toast'
import { API_BASE } from '@/lib/api'

/** 模块级：跨组件挂载/卸载周期持久化 viewport，不写入 store */
let _savedViewport: Viewport | null = null

const nodeTypes = {
  sessionNode: SessionNode as any,
}

const edgeTypes = {
  flowEdge: FlowEdge as any,
}

/** 内部组件：包含 ReactFlow，需要在 ReactFlowProvider 内部使用 */
function CanvasViewContent() {
  const sessions = useSessionStore(s => s.sessions)
  const canvasEdges = useSessionStore(s => s.canvasEdges)
  const connectionStatus = useSessionStore(s => s.connectionStatus)
  const openTab = useSessionStore(s => s.openTab)
  const updateCanvasPosition = useSessionStore(s => s.updateCanvasPosition)
  const { screenToFlowPosition } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const containerRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [fitOnMount] = useState(() => _savedViewport === null)

  // 同步 Canvas 边（持久化）
  useEffect(() => {
    const allEdges: Edge[] = canvasEdges.map(pe => ({
      id: pe.id,
      source: pe.sourceSessionId,
      target: pe.targetSessionId,
      label: pe.trigger,
      type: 'flowEdge',
    }))
    setEdges(prev => {
      const serverPairs = new Set(allEdges.map(e => `${e.source}__${e.target}`))
      const pendingEdges = prev.filter((e: Edge) => !serverPairs.has(`${e.source}__${e.target}`))
      return [...allEdges, ...pendingEdges]
    })
  }, [canvasEdges, setEdges])

  // 用户拖线连接两个节点 → 创建 canvas edge（持久化）
  const onConnect = useCallback(
    async (connection: Connection) => {
      const { source, target } = connection
      if (!source || !target) return

      if (source === target) {
        toastError('不能将会话连接到自身')
        return
      }

      const duplicate = edges.some((e: Edge) => e.source === source && e.target === target)
      if (duplicate) {
        toastError('该方向的连线已存在')
        return
      }

      try {
        const res = await fetch(`${API_BASE}/canvas/edges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceSessionId: source,
            targetSessionId: target,
            trigger: 'on-complete',
            injectContext: true,
          }),
        })
        if (!res.ok) {
          const errData = await res.json()
          throw new Error(errData.error || `HTTP 错误 ${res.status}`)
        }
        // canvas:edges WS 事件会自动更新 canvasEdges，触发上面的 useEffect 同步
      } catch (err: any) {
        toastError(`创建连线失败: ${err instanceof Error ? err.message : err}`)
        return
      }
      setEdges(eds => addEdge(connection, eds))
    },
    [edges, setEdges],
  )

  // 处理连线删除（持久化）
  const onEdgesDelete = useCallback(
    async (edgesToDelete: Edge[]) => {
      for (const edge of edgesToDelete) {
        try {
          const res = await fetch(`${API_BASE}/canvas/edges/${edge.id}`, {
            method: 'DELETE',
          })
          if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
        } catch (err: any) {
          toastError(`删除连线失败: ${err instanceof Error ? err.message : err}`)
        }
      }
    },
    [],
  )

  // 同步节点：精细化比较，只在新增/删除/位置/status/progress 变化时更新
  useEffect(() => {
    setNodes(prev => {
      const prevMap = new Map(prev.map(n => [n.id, n]))
      let changed = false

      const next: Node[] = sessions.map(s => {
        const existing = prevMap.get(s.id)
        if (!existing) {
          changed = true
          return {
            id: s.id,
            type: 'sessionNode',
            position: s.canvasPosition,
            data: { session: s },
          } as Node
        }

        const prevSession = (existing.data as { session: typeof s } | undefined)?.session
        if (
          existing.position.x !== s.canvasPosition.x ||
          existing.position.y !== s.canvasPosition.y ||
          prevSession?.status !== s.status ||
          prevSession?.progress !== s.progress ||
          prevSession?.name !== s.name ||
          prevSession?.branchName !== s.branchName ||
          prevSession?.lastAiMessage !== s.lastAiMessage
        ) {
          changed = true
          return {
            ...existing,
            position: s.canvasPosition,
            data: { session: s },
          } as Node
        }
        return existing
      })

      if (prev.length !== next.length) changed = true
      else {
        const nextIds = new Set(next.map(n => n.id))
        for (const n of prev) {
          if (!nextIds.has(n.id)) {
            changed = true
            break
          }
        }
      }

      return changed ? next : prev
    })
  }, [sessions, setNodes])

  const onMoveEnd = useCallback((_evt: unknown, viewport: Viewport) => {
    _savedViewport = viewport
  }, [])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      openTab(node.id)
    },
    [openTab]
  )

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      updateCanvasPosition(node.id, node.position)
    },
    [updateCanvasPosition]
  )

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })
  }, [screenToFlowPosition])

  const closeMenu = useCallback(() => setMenuPos(null), [])

  const isEmpty = sessions.length === 0

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={closeMenu}
        defaultViewport={_savedViewport ?? undefined}
        fitView={fitOnMount}
        fitViewOptions={{ padding: 0.2 }}
        onMoveEnd={onMoveEnd}
        connectOnClick={false}
        connectionRadius={80}
        deleteKeyCode={['Delete', 'Backspace']}
      >
        <Background gap={16} size={1} />
        <Controls />
        {menuPos && (
          <CanvasContextMenu
            x={menuPos.x}
            y={menuPos.y}
            flowPosition={screenToFlowPosition({ x: menuPos.x, y: menuPos.y })}
            onClose={closeMenu}
          />
        )}
      </ReactFlow>

      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
            {connectionStatus === 'connecting' && (
              <>
                <Loader2 className="h-8 w-8 animate-spin opacity-40" />
                <p className="text-sm">正在连接后端服务…</p>
              </>
            )}
            {(connectionStatus === 'disconnected' || connectionStatus === 'failed') && (
              <>
                <ServerOff className="h-8 w-8 opacity-40" />
                <p className="text-sm">后端未连接，请启动服务后刷新</p>
              </>
            )}
            {connectionStatus === 'connected' && (
              <>
                <LayoutGrid className="h-8 w-8 opacity-40" />
                <p className="text-sm">暂无会话，点击「新建会话」开始</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 导出的 CanvasView：提供 ReactFlowProvider */
export function CanvasView() {
  return (
    <ReactFlowProvider>
      <CanvasViewContent />
    </ReactFlowProvider>
  )
}
