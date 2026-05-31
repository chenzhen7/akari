import { useEffect, useState } from 'react'
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
import { usePanelRef } from 'react-resizable-panels'

function WebSocketProvider() {
  useWebSocket()
  return null
}

export function AppShell() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const viewMode = useSessionStore(s => s.viewMode)
  const { send } = useWebSocket()

  const leftPanelRef = usePanelRef()
  const rightPanelRef = usePanelRef()
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)

  const session = activeTabId ? sessions.find(s => s.id === activeTabId) : undefined

  // activeTabId 变化时自动展开/收起右侧
  useEffect(() => {
    const handle = rightPanelRef.current
    if (!handle) return
    if (activeTabId) {
      handle.expand()
      setRightCollapsed(false)
    } else {
      handle.collapse()
      setRightCollapsed(true)
    }
  }, [activeTabId])

  const toggleLeft = () => {
    const handle = leftPanelRef.current
    if (!handle) return
    if (leftCollapsed) {
      handle.expand()
      setLeftCollapsed(false)
    } else {
      handle.collapse()
      setLeftCollapsed(true)
    }
  }

  const toggleRight = () => {
    const handle = rightPanelRef.current
    if (!handle) return
    if (rightCollapsed) {
      handle.expand()
      setRightCollapsed(false)
    } else {
      handle.collapse()
      setRightCollapsed(true)
    }
  }

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
          <ResizablePanel
            panelRef={leftPanelRef}
            defaultSize="15%"
            minSize="12%"
            maxSize="30%"
            collapsible
            collapsedSize="0%"
            disabled={leftCollapsed}
          >
            <SessionSidebar />
          </ResizablePanel>

          <ResizableHandle withHandle disabled={leftCollapsed} />

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

          {/* Right Handle */}
          <ResizableHandle
            withHandle
            disabled={rightCollapsed || !activeTabId}
          />

          {/* Right Sidebar */}
          <ResizablePanel
            panelRef={rightPanelRef}
            defaultSize="25%"
            minSize="15%"
            maxSize="40%"
            collapsible
            collapsedSize="0%"
            disabled={rightCollapsed}
          >
            {activeTabId && session ? (
              <RightSidebar session={session} />
            ) : (
              <div />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
        <CommandCenter />
        <CreateSessionDialog />
      </div>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  )
}
