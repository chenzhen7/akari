import { TopNav } from './TopNav'
import { useSessionStore } from '@/stores/session-store'
import { CanvasView } from '@/components/canvas/CanvasView'
import { KanbanView } from '@/components/kanban/KanbanView'
import { SessionDetail } from '@/components/session/SessionDetail'
import { CommandCenter } from '@/components/command-center/CommandCenter'
import { CreateSessionDialog } from '@/components/create-session/CreateSessionDialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useWebSocket } from '@/hooks/useWebSocket'

function WebSocketProvider() {
  useWebSocket()
  return null
}

export function AppShell() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const viewMode = useSessionStore(s => s.viewMode)

  return (
    <TooltipProvider>
      <WebSocketProvider />
      <div className="flex h-svh flex-col bg-background">
        <TopNav />
        <div className="flex-1 overflow-hidden">
          {activeTabId ? (
            <SessionDetail />
          ) : viewMode === 'canvas' ? (
            <CanvasView />
          ) : (
            <KanbanView />
          )}
        </div>
        <CommandCenter />
        <CreateSessionDialog />
      </div>
    </TooltipProvider>
  )
}
