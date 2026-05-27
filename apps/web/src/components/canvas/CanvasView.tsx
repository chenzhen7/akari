import { useEffect, useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSessionStore } from '@/stores/session-store'
import { SessionNode } from './SessionNode'
import { CanvasContextMenu } from './CanvasContextMenu'
import { Loader2, ServerOff, LayoutGrid } from 'lucide-react'
import { toast } from 'sonner'

/** 模块级：跨组件挂载/卸载周期持久化 viewport，不写入 store */
let _savedViewport: Viewport | null = null

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

const nodeTypes = {
  sessionNode: SessionNode as any,
}

export function CanvasView() {
  const sessions = useSessionStore(s => s.sessions)
  const groups = useSessionStore(s => s.groups)
  const connectionStatus = useSessionStore(s => s.connectionStatus)
  const openTab = useSessionStore(s => s.openTab)
  const updateCanvasPosition = useSessionStore(s => s.updateCanvasPosition)
  const fetchGroups = useSessionStore(s => s.fetchGroups)

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  // 本次挂载是否应 fitView：仅当还没有保存的 viewport 时才自动适配
  const [fitOnMount] = useState(() => _savedViewport === null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)

  // 同步 Pipeline 边：从 groups 中提取所有 pipelineEdges
  useEffect(() => {
    const allEdges: Edge[] = []
    for (const group of groups) {
      for (const pe of group.pipelineEdges) {
        allEdges.push({
          id: pe.id,
          source: pe.fromSessionId,
          target: pe.toSessionId,
          label: pe.trigger === 'on-checkpoint' && pe.checkpointPattern
            ? `${pe.trigger}: ${pe.checkpointPattern}`
            : pe.trigger,
          animated: true,
          style: { stroke: '#6366f1', strokeWidth: 3.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
          data: { groupId: group.id, injectContext: pe.injectContext },
        })
      }
    }
    // Parent → child dashed edges (from spawn)
    for (const s of sessions) {
      if (s.parentSessionId) {
        const edgeId = `spawn-${s.parentSessionId}-${s.id}`
        if (!allEdges.find(e => e.id === edgeId)) {
          allEdges.push({
            id: edgeId,
            source: s.parentSessionId,
            target: s.id,
            style: { stroke: '#94a3b8', strokeWidth: 2.5, strokeDasharray: '5,3' },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
            label: 'spawned',
          })
        }
      }
    }
    // merge：保留服务端尚未确认的本地临时边（相同 source-target 的只保留服务端版本）
    const serverPairs = new Set(allEdges.map(e => `${e.source}__${e.target}`))
    setEdges((prev: Edge[]) => {
      const pendingEdges = prev.filter((e: Edge) => !serverPairs.has(`${e.source}__${e.target}`))
      return [...allEdges, ...pendingEdges]
    })
  }, [groups, sessions, setEdges])

  // 用户拖线连接两个节点 → 创建 pipeline edge
  const onConnect = useCallback(
    async (connection: Connection) => {
      const { source, target } = connection
      if (!source || !target) return

      const sourceSession = sessions.find(s => s.id === source)
      const targetSession = sessions.find(s => s.id === target)
      if (!sourceSession || !targetSession) return

      // 找到或创建包含这两个 session 的 group
      let groupId = groups.find(g => g.sessionIds.includes(source) && g.sessionIds.includes(target))?.id
      if (!groupId) {
        try {
          const res = await fetch(`${API_BASE}/collaboration/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `${sourceSession.name} → ${targetSession.name}`, sessionIds: [source, target] }),
          })
          const group = await res.json()
          groupId = group.id
          fetchGroups()
        } catch {
          toast.error('创建协作组失败')
          return
        }
      }

      // 添加流水线边
      try {
        const res = await fetch(`${API_BASE}/collaboration/groups/${groupId}/edges`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromSessionId: source, toSessionId: target, trigger: 'on-complete', injectContext: true }),
        })
        if (!res.ok) {
          const errData = await res.json()
          throw new Error(errData.error || `HTTP 错误 ${res.status}`)
        }
        fetchGroups()
        toast.success('Pipeline 连接已创建')
      } catch (err: any) {
        toast.error(`创建 Pipeline 边失败: ${err instanceof Error ? err.message : err}`)
      }
      setEdges(eds => addEdge(connection, eds))
    },
    [sessions, groups, fetchGroups, setEdges],
  )

  // 处理连线删除：用户按下 Delete 或 Backspace 键删除选中的连线
  const onEdgesDelete = useCallback(
    async (edgesToDelete: Edge[]) => {
      for (const edge of edgesToDelete) {
        if (edge.id.startsWith('spawn-')) continue

        const groupId = edge.data?.groupId
        if (!groupId) continue

        try {
          const res = await fetch(`${API_BASE}/collaboration/groups/${groupId}/edges/${edge.id}`, {
            method: 'DELETE',
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          toast.success('Pipeline 连接已删除')
        } catch (err: any) {
          toast.error(`删除 Pipeline 边失败: ${err instanceof Error ? err.message : err}`)
        }
      }
      fetchGroups()
    },
    [fetchGroups]
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
          prevSession?.branchName !== s.branchName
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
    setMenuPos({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }, [])

  const closeMenu = useCallback(() => setMenuPos(null), [])

  const isEmpty = sessions.length === 0

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={closeMenu}
        onMoveStart={closeMenu}
        defaultViewport={_savedViewport ?? undefined}
        fitView={fitOnMount}
        fitViewOptions={{ padding: 0.2 }}
        onMoveEnd={onMoveEnd}
        connectOnClick={false}
        deleteKeyCode={['Delete', 'Backspace']}
      >
        <Background gap={16} size={1} />
        <Controls />
        {menuPos && (
          <CanvasContextMenu
            x={menuPos.x}
            y={menuPos.y}
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
