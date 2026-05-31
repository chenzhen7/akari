import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/session-store'
import { GitBranch, Circle } from 'lucide-react'

const statusColorMap: Record<string, string> = {
  running: 'fill-green-500 text-green-500',
  waiting: 'fill-amber-500 text-amber-500',
  failed: 'fill-red-500 text-red-500',
  completed: 'fill-blue-500 text-blue-500',
  initializing: 'fill-slate-400 text-slate-400',
  paused: 'fill-orange-500 text-orange-500',
  review: 'fill-purple-500 text-purple-500',
  archived: 'fill-slate-500 text-slate-500',
}

export function SessionSidebar() {
  const sessions = useSessionStore(s => s.sessions)
  const openTab = useSessionStore(s => s.openTab)
  const activeTabId = useSessionStore(s => s.activeTabId)

  return (
    <aside className="flex h-full w-full flex-col bg-card">
      <div className="flex h-full w-full flex-col">
        {/* Header */}
        <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            会话列表
          </span>
          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
            {sessions.length}
          </span>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {sessions.map(session => {
            const isActive = session.id === activeTabId
            const additions = session.diffSummary?.additions ?? 0
            const deletions = session.diffSummary?.deletions ?? 0
            return (
              <button
                key={session.id}
                onClick={() => openTab(session.id)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-all',
                  isActive
                    ? 'border-primary/40 bg-primary/5 shadow-sm'
                    : 'border-transparent bg-muted/40 hover:bg-muted/60',
                )}
              >
                <Circle className={cn('mt-0.5 h-2 w-2 shrink-0', statusColorMap[session.status] ?? 'fill-slate-400 text-slate-400')} />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-xs font-medium', isActive && 'text-primary')}>
                    {session.name}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <GitBranch className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{session.branchName}</span>
                  </div>
                  {(additions > 0 || deletions > 0) && (
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] font-mono">
                      {additions > 0 && <span className="text-green-500">+{additions}</span>}
                      {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
