import { useEffect } from 'react'
import { TopNav } from './TopNav'
import { SessionSidebar } from './SessionSidebar'
import { RightSidebar } from './RightSidebar'
import { useSessionStore } from '@/stores/session-store'
import { CanvasView } from '@/components/canvas/CanvasView'
import { KanbanView } from '@/components/kanban/KanbanView'
import { TerminalPanel } from '@/components/session/TerminalPanel'
import { CommandCenter } from '@/components/command-center/CommandCenter'
import { CreateSessionDialog } from '@/components/create-session/CreateSessionDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Toaster } from 'sonner'
import { useResizablePanels } from '@/hooks/useResizablePanels'
import { cn } from '@/lib/utils'
import { GripVertical } from 'lucide-react'

function WebSocketProvider() {
  useWebSocket()
  return null
}

function ResizeHandle({
  onMouseDown,
  disabled,
  isDragging,
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
        isDragging && 'bg-primary',
        className,
      )}
      onMouseDown={disabled ? undefined : onMouseDown}
    >
      <div
        className={cn(
          'absolute inset-y-0 w-1 -translate-x-1/2 transition-colors',
          !disabled && !isDragging && 'bg-transparent group-hover:bg-primary/30',
        )}
      />
      {!disabled && (
        <div className="z-10 flex h-6 w-3 items-center justify-center rounded-sm border bg-border opacity-0 transition-opacity group-hover:opacity-100">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </div>
  )
}

export function AppShell() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const viewMode = useSessionStore(s => s.viewMode)
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
  } = useResizablePanels({
    initialLeftWidth: 15,
    minLeftWidth: 12,
    maxLeftWidth: 30,
    initialRightWidth: 25,
    minRightWidth: 15,
    maxRightWidth: 40,
  })

  const session = activeTabId ? sessions.find(s => s.id === activeTabId) : undefined

  // activeTabId 变化时自动展开/收起右侧
  useEffect(() => {
    if (activeTabId) {
      expandRight()
    } else {
      collapseRight()
    }
  }, [activeTabId, expandRight, collapseRight])

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

  const middleWidth = leftCollapsed
    ? rightCollapsed
      ? '100%'
      : `${100 - rightWidth}%`
    : rightCollapsed
      ? `${100 - leftWidth}%`
      : `${100 - leftWidth - rightWidth}%`

  const isResizing = isDraggingLeft || isDraggingRight

  return (
    <TooltipProvider>
      <WebSocketProvider />
      <div className={cn('flex h-svh flex-col bg-card select-none', isResizing && 'select-none cursor-col-resize')}>
        <TopNav
          leftCollapsed={leftCollapsed}
          onToggleLeft={toggleLeft}
          rightCollapsed={rightCollapsed}
          onToggleRight={toggleRight}
          hasRightPanel={!!activeTabId}
        />
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar */}
          <div
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
          <div className="min-w-0 flex-1 overflow-hidden rounded-xl" style={{ width: middleWidth }}>
            {activeTabId && session ? (
              <TerminalPanel session={session} send={send} />
            ) : viewMode === 'canvas' ? (
              <CanvasView />
            ) : (
              <KanbanView />
            )}
          </div>

          {/* Right Handle */}
          {activeTabId && (
            <ResizeHandle
              onMouseDown={onRightHandleMouseDown}
              disabled={rightCollapsed}
              isDragging={isDraggingRight}
            />
          )}

          {/* Right Sidebar */}
          <div
            className={cn(
              'shrink-0 overflow-hidden transition-[width] duration-150',
              isResizing && 'transition-none',
            )}
            style={{ width: rightCollapsed ? '0px' : `${rightWidth}%` }}
          >
            {activeTabId && session ? (
              <RightSidebar session={session} />
            ) : (
              <div />
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
