import { useEffect } from 'react'
import { TopNav } from './TopNav'
import { SessionSidebar } from './SessionSidebar'
import { RightSidebar } from './RightSidebar'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import { CANVAS_ENABLED } from '@/shared/lib/feature-flags'
import { MiddleTabBar } from '@/features/session/components/MiddleTabBar'
import { TabContent } from '@/features/session/components/TabContent'
import { CanvasView } from '@/features/canvas/components/CanvasView'
import { KanbanView } from '@/features/kanban/components/KanbanView'
import { CommandCenter } from '@/features/command-center/components/CommandCenter'
import { CreateSessionDialog } from '@/features/session/components/CreateSessionDialog'
import { ShortcutsHelpDialog } from '@/features/layout/components/ShortcutsHelpDialog'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { useWebSocket } from '@/shared/hooks/useWebSocket'
import { useGlobalShortcuts } from '@/shared/hooks/useGlobalShortcuts'
import { Toaster } from 'sonner'
import { useResizablePanels } from '@/shared/hooks/useResizablePanels'
import { cn } from '@/shared/lib/utils'
import { GripVertical, LayoutGrid } from 'lucide-react'

function ResizeHandle({
  onMouseDown,
  disabled,
  className,
}: {
  onMouseDown: (e: React.MouseEvent) => void
  disabled?: boolean
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
  const activeSessionId = useNavigationStore(s => s.sessionId)
  const globalViewMode = useNavigationStore(s => s.viewMode)
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

  const toggleLeft = () => (leftCollapsed ? expandLeft() : collapseLeft())
  const toggleRight = () => (rightCollapsed ? expandRight() : collapseRight())

  useGlobalShortcuts({ toggleLeft, toggleRight })

  const isResizing = isDraggingLeft || isDraggingRight

  // 画布功能临时关闭：若当前处于画布模式则自动切回默认视图
  useEffect(() => {
    if (!CANVAS_ENABLED && globalViewMode === 'canvas') {
      useNavigationStore.getState().setViewMode(null)
    }
  }, [globalViewMode])

  return (
    <TooltipProvider>
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
          />

          {/* Middle */}
          <div className="min-w-0 flex-1 overflow-hidden rounded-tl-xl border border-r-0 bg-[var(--terminal-background)] shadow-md">
            {globalViewMode === 'canvas' && CANVAS_ENABLED ? (
              <CanvasView />
            ) : globalViewMode === 'kanban' ? (
              <KanbanView />
            ) : activeSessionId ? (
              <div className="flex h-full flex-col px-2 ">
                <MiddleTabBar sessionId={activeSessionId} />
                <div className="flex-1 overflow-hidden">
                  <TabContent sessionId={activeSessionId} send={send} />
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
            className="bg-foreground/15"
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
            <RightSidebar sessionId={activeSessionId ?? undefined} />
          </div>
        </div>
        <CommandCenter />
        <CreateSessionDialog />
        <ShortcutsHelpDialog />
      </div>
      <Toaster richColors position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
