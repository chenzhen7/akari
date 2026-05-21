import { useEffect, useCallback, useRef } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSessionStore } from '@/stores/session-store'
import { SessionNode } from './SessionNode'
import { Loader2, ServerOff, LayoutGrid } from 'lucide-react'

const nodeTypes = {
  sessionNode: SessionNode as any,
}

export function CanvasView() {
  const sessions = useSessionStore(s => s.sessions)
  const connectionStatus = useSessionStore(s => s.connectionStatus)
  const openTab = useSessionStore(s => s.openTab)
  const updateCanvasPosition = useSessionStore(s => s.updateCanvasPosition)

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const fitted = useRef(false)

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

  // 只在首次有节点时 fitView
  useEffect(() => {
    if (!fitted.current && nodes.length > 0) {
      fitted.current = true
    }
  }, [nodes])

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

  const isEmpty = sessions.length === 0

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        fitView={!fitted.current}
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background gap={16} size={1} />
        <Controls />
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
