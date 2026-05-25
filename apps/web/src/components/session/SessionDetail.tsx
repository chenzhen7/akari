import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { TaskPanel } from './TaskPanel'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'

export function SessionDetail() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const setActiveTab = useSessionStore(s => s.setActiveTab)
  const { send } = useWebSocket()

  const session = sessions.find(s => s.id === activeTabId)
  if (!session) return null

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => setActiveTab(null)}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-medium">{session.name}</span>
        {session.status === 'initializing' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top section */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Task info */}
          <div className="w-1/2 overflow-auto border-r border-border p-4">
            <TaskPanel session={session} />
          </div>

          {/* Right: Diff viewer */}
          <div className="flex w-1/2 flex-col overflow-hidden p-4">
            <h3 className="mb-2 shrink-0 text-sm font-semibold">Git Diff</h3>
            <div className="min-h-0 flex-1">
              <DiffViewer sessionId={session.id} diffFiles={session.diffFiles} />
            </div>
          </div>
        </div>

        {/* Terminal */}
        <div className="h-[40%] border-t border-border">
          <TerminalPanel session={session} send={send} />
        </div>
      </div>

    </div>
  )
}
