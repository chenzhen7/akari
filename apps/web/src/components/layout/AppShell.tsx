import { useEffect } from 'react'
import { TopNav } from './TopNav'
import { SessionSidebar } from './SessionSidebar'
import { RightSidebar } from './RightSidebar'
import { useSessionStore } from '@/stores/session-store'
import { SessionDetail } from '@/components/session/SessionDetail'
import { CanvasView } from '@/components/canvas/CanvasView'
import { KanbanView } from '@/components/kanban/KanbanView'
import { DiffViewer } from '@/components/diff/DiffViewer'
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
  const detailViewMode = useSessionStore(s => s.detailViewMode)
  const selectedDiffFile = useSessionStore(s => s.selectedDiffFile)
  const setSelectedDiffFile = useSessionStore(s => s.setSelectedDiffFile)
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
      <div className={cn('flex h-svh flex-col bg-panel select-none', isResizing && 'select-none cursor-col-resize')}>
        <TopNav
          leftCollapsed={leftCollapsed}
          onToggleLeft={toggleLeft}
          rightCollapsed={rightCollapsed}
          onToggleRight={toggleRight}
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
          <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-panel" style={{ width: middleWidth }}>
            {selectedDiffFile && session ? (
              <DiffViewer
                session={session}
                filePath={selectedDiffFile}
                onBack={() => setSelectedDiffFile(null)}
              />
            ) : detailViewMode === 'terminal' && session ? (
              <SessionDetail session={session} send={send} />
            ) : detailViewMode === 'canvas' ? (
              <CanvasView />
            ) : detailViewMode === 'kanban' ? (
              <KanbanView />
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
