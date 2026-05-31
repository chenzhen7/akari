import { useState } from 'react'
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
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'

function WebSocketProvider() {
  useWebSocket()
  return null
}

export function AppShell() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const viewMode = useSessionStore(s => s.viewMode)
  const { send } = useWebSocket()

  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)

  const session = activeTabId ? sessions.find(s => s.id === activeTabId) : undefined

  const toggleLeft = () => setLeftCollapsed(prev => !prev)
  const toggleRight = () => setRightCollapsed(prev => !prev)

  return (
    <TooltipProvider>
      <WebSocketProvider />
      <div className="flex h-svh flex-col bg-background">
        <TopNav
          leftCollapsed={leftCollapsed}
          onToggleLeft={toggleLeft}
          rightCollapsed={rightCollapsed}
          onToggleRight={toggleRight}
          hasRightPanel={!!activeTabId}
        />
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Left Sidebar */}
          {!leftCollapsed && (
            <>
              <ResizablePanel defaultSize="15%" minSize="12%" maxSize="30%">
                <SessionSidebar />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          {leftCollapsed && <ResizableHandle withHandle disabled />}

          {/* Middle */}
          <ResizablePanel defaultSize={activeTabId ? '60%' : '85%'} minSize="30%">
            {activeTabId && session ? (
              <TerminalPanel session={session} send={send} />
            ) : viewMode === 'canvas' ? (
              <CanvasView />
            ) : (
              <KanbanView />
            )}
          </ResizablePanel>

          {/* Right Sidebar */}
          {!rightCollapsed && activeTabId ? (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="25%" minSize="15%" maxSize="40%">
                {session && <RightSidebar session={session} />}
              </ResizablePanel>
            </>
          ) : (
            <ResizableHandle withHandle disabled />
          )}
        </ResizablePanelGroup>
        <CommandCenter />
        <CreateSessionDialog />
      </div>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  )
}
