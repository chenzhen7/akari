import { useSessionStore } from '@/stores/session-store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  Circle,
  GitBranch,
} from 'lucide-react'

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
  const sidebarOpen = useSessionStore(s => s.sidebarOpen)
  const sessions = useSessionStore(s => s.sessions)
  const openTab = useSessionStore(s => s.openTab)
  const activeTabId = useSessionStore(s => s.activeTabId)

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-in-out',
        sidebarOpen ? 'w-60' : 'w-0 overflow-hidden',
      )}
    >
      <div className="flex h-full w-60 flex-col">
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
        <ScrollArea className="flex-1 py-1">
          {sessions.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              暂无会话
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 px-1.5">
              {sessions.map(session => {
                const dotCls = statusColorMap[session.status] ?? 'fill-slate-400 text-slate-400'
                const isActive = activeTabId === session.id
                const totalAdditions = session.diffFiles?.reduce((s, f) => s + f.additions, 0) ?? 0
                const totalDeletions = session.diffFiles?.reduce((s, f) => s + f.deletions, 0) ?? 0
                return (
                  <button
                    key={session.id}
                    onClick={() => openTab(session.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      isActive
                        ? 'bg-accent/60'
                        : 'hover:bg-muted/50',
                    )}
                  >
                    <Circle className={cn('h-2 w-2 shrink-0', dotCls)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] leading-tight font-medium text-foreground">
                        {session.name}
                      </div>
                      <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                        <GitBranch className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate font-mono">{session.branchName}</span>
                      </div>
                    </div>
                    {/* Diff summary */}
                    {(totalAdditions > 0 || totalDeletions > 0) && (
                      <div className="shrink-0 font-mono text-[10px] leading-none">
                        {totalAdditions > 0 && (
                          <span className="text-green-500">+{totalAdditions}</span>
                        )}
                        {totalAdditions > 0 && totalDeletions > 0 && (
                          <span className="text-muted-foreground/50"> </span>
                        )}
                        {totalDeletions > 0 && (
                          <span className="text-red-400">-{totalDeletions}</span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </aside>
  )
}
