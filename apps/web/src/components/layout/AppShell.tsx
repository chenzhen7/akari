import { useEffect } from 'react'
import { TopNav } from './TopNav'
import { SessionSidebar } from './SessionSidebar'
import { RightSidebar } from './RightSidebar'
import { useSessionStore, CANVAS_ENABLED } from '@/stores/session-store'
import { MiddleTabBar } from '@/components/session/MiddleTabBar'
import { TabContent } from '@/components/session/TabContent'
import { CanvasView } from '@/components/canvas/CanvasView'
import { KanbanView } from '@/components/kanban/KanbanView'
import { CommandCenter } from '@/components/command-center/CommandCenter'
import { CreateSessionDialog } from '@/components/create-session/CreateSessionDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Toaster } from 'sonner'
import { useResizablePanels } from '@/hooks/useResizablePanels'
import { cn } from '@/lib/utils'
import { GripVertical, LayoutGrid } from 'lucide-react'

function WebSocketProvider() {
  useWebSocket()
  return null
}

function ResizeHandle({
  onMouseDown,
  disabled,
  isDragging: _isDragging,
  className,
}: {
  onMouseDown: (e: React.MouseEvent) => void
  disabled?: boolean
  isDragging?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'group relative flex w-px shrink-0 items-center justify-center',
        disabled ? 'cursor-not-allowed opacity-30' : 'cursor-col-resize',
        className,
      )}
      onMouseDown={disabled ? undefined : onMouseDown}
    >
      <div className="absolute inset-y-0 w-1 -translate-x-1/2" />
      {!disabled && (
        <div className="z-10 flex h-6 w-3 items-center justify-center rounded-sm border bg-border opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const session = useSessionStore(s => s.activeSessionId ? s.sessions.find(ses => ses.id === s.activeSessionId) : undefined)
  const globalViewMode = useSessionStore(s => s.globalViewMode)
  const { send } = useWebSocket()

  const {
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    expandLeft,
    collapseLeft,
    expandRight,
    collapseRight,
    onLeftHandleMouseDown,
    onRightHandleMouseDown,
    isDraggingLeft,
    isDraggingRight,
    containerRef,
  } = useResizablePanels({
    initialLeftWidth: 20,
    minLeftWidth: 12,
    maxLeftWidth: 30,
    initialRightWidth: 20,
    minRightWidth: 12,
    maxRightWidth: 30,
  })

  // 初始加载时展开右侧
  useEffect(() => {
    expandRight()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleLeft = () => {
    if (leftCollapsed) {
      expandLeft()
    } else {
      collapseLeft()
    }
  }

  const toggleRight = () => {
    if (rightCollapsed) {
      expandRight()
    } else {
      collapseRight()
    }
  }

  const isResizing = isDraggingLeft || isDraggingRight

  // 画布功能临时关闭：若当前处于画布模式则自动切回默认视图
  useEffect(() => {
    if (!CANVAS_ENABLED && globalViewMode === 'canvas') {
      useSessionStore.getState().setGlobalViewMode(null)
    }
  }, [globalViewMode])

  return (
    <TooltipProvider>
      <WebSocketProvider />
      <div className={cn('flex h-svh flex-col bg-panel select-none', isResizing && 'select-none cursor-col-resize')}>
        <TopNav
          leftCollapsed={leftCollapsed}
          onToggleLeft={toggleLeft}
          rightCollapsed={rightCollapsed}
          onToggleRight={toggleRight}
        />
        <div ref={containerRef} className="flex flex-1 overflow-hidden">
          {/* Left Sidebar */}
          <div
            data-resizable-panel="left"
            className={cn(
              'shrink-0 overflow-hidden transition-[width] duration-150',
              isResizing && 'transition-none',
            )}
            style={{ width: leftCollapsed ? '0px' : `${leftWidth}%` }}
          >
            <SessionSidebar />
          </div>

          {/* Left Handle */}
          <ResizeHandle
            onMouseDown={onLeftHandleMouseDown}
            disabled={leftCollapsed}
            isDragging={isDraggingLeft}
          />

          {/* Middle */}
          <div className="min-w-0 flex-1 overflow-hidden rounded-t-xl border bg-[var(--terminal-background)] shadow-sm">
            {globalViewMode === 'canvas' && CANVAS_ENABLED ? (
              <CanvasView />
            ) : globalViewMode === 'kanban' ? (
              <KanbanView />
            ) : session ? (
              <div className="flex h-full flex-col px-2 ">
                <MiddleTabBar session={session} />
                <div className="flex-1 overflow-hidden">
                  <TabContent session={session} send={send} />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <LayoutGrid className="h-10 w-10 opacity-30" />
                <p className="text-sm">暂无会话，点击「新建会话」开始</p>
              </div>
            )}
          </div>

          {/* Right Handle */}
          <ResizeHandle
            onMouseDown={onRightHandleMouseDown}
            disabled={rightCollapsed}
            isDragging={isDraggingRight}
          />

          {/* Right Sidebar */}
          <div
            data-resizable-panel="right"
            className={cn(
              'shrink-0 overflow-hidden transition-[width] duration-150',
              isResizing && 'transition-none',
            )}
            style={{ width: rightCollapsed ? '0px' : `${rightWidth}%` }}
          >
            {session ? (
              <RightSidebar session={session} />
            ) : (
              <RightSidebar />
            )}
          </div>
        </div>
        <CommandCenter />
        <CreateSessionDialog />
      </div>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  )
}
