import { useState } from 'react'
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
    <div className="flex h-full w-full flex-col">
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
