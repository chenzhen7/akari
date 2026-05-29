import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { TerminalPanel } from './TerminalPanel'
import { SessionInfoPanel } from './SessionInfoPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { GitGraphPanel } from '@/components/git/GitGraphPanel'
import { ActivityBar, type ActivePanel } from './ActivityBar'
import { cn } from '@/lib/utils'

export function SessionDetail() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const setActiveTab = useSessionStore(s => s.setActiveTab)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const pendingOps = useSessionStore(s => s.pendingOps)
  const { send } = useWebSocket()
  const [activePanel, setActivePanel] = useState<ActivePanel>('terminal')

  const session = sessions.find(s => s.id === activeTabId)
  if (!session) return null

  const isArchived = session.status === 'archived'
  const isPending = pendingOps.has(session.id)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setActiveTab(null)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-medium">{session.name}</span>
        {session.status === 'initializing' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        {session.agentType && (
          <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {session.agentType}
          </span>
        )}
      </div>

      {/* Body: activity bar + content */}
      <div className="flex flex-1 overflow-hidden">
        <ActivityBar
          activePanel={activePanel}
          onPanelChange={setActivePanel}
          diffCount={session.diffFiles?.length ?? 0}
          onArchive={() => archiveSession(session.id)}
          showArchive={!isArchived}
          onRestore={() => restoreSession(session.id)}
          showRestore={isArchived}
          restorePending={isPending}
        />

        {/* Content panels — Terminal always mounted to preserve xterm instance */}
        <div className="relative flex-1 overflow-hidden">
          <div className={cn('absolute inset-0', activePanel !== 'terminal' && 'hidden')}>
            <TerminalPanel session={session} send={send} />
          </div>
          <div className={cn('absolute inset-0', activePanel !== 'git-graph' && 'hidden')}>
            <GitGraphPanel sessionId={session.id} />
          </div>
          <div className={cn('absolute inset-0 overflow-hidden', activePanel !== 'diff' && 'hidden')}>
            <DiffViewer session={session} />
          </div>
          <div className={cn('absolute inset-0 overflow-hidden', activePanel !== 'info' && 'hidden')}>
            <SessionInfoPanel session={session} />
          </div>
        </div>
      </div>
    </div>
  )
}
