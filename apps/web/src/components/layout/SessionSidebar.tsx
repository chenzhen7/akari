import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/session-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GitBranch, Circle, Plus, Archive, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import type { AgentSession } from '@/types'

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

function SessionItem({ session, isActive }: { session: AgentSession; isActive: boolean }) {
  const openTab = useSessionStore(s => s.openTab)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const pendingOps = useSessionStore(s => s.pendingOps)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isPending = pendingOps.has(session.id)
  const isTerminal = ['archived', 'merged'].includes(session.status)
  const additions = session.diffSummary?.additions ?? 0
  const deletions = session.diffSummary?.deletions ?? 0

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation()
    archiveSession(session.id)
  }

  const handleRestore = (e: React.MouseEvent) => {
    e.stopPropagation()
    restoreSession(session.id)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(true)
  }

  return (
    <>
      <button
        onClick={() => openTab(session.id)}
        className={cn(
          'group flex w-full flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-all',
          isActive
            ? 'border-primary/40 bg-primary/5 shadow-sm'
            : 'border-transparent hover:bg-muted/60 hover:border-border/30',
        )}
      >
        {/* 第一行：状态 + 名称 + 右上角 diff */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Circle className={cn('mt-0.5 h-2 w-2 shrink-0', statusColorMap[session.status] ?? 'fill-slate-400 text-slate-400')} />
            <p className={cn('truncate text-xs font-medium', isActive && 'text-primary')}>
              {session.name}
            </p>
          </div>
          {(additions > 0 || deletions > 0) && (
            <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
              {additions > 0 && <span className="text-green-500">+{additions}</span>}
              {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
            </div>
          )}
        </div>

        {/* 第二行：branchName + 右下角操作按钮 */}
        <div className="flex items-center justify-between gap-1 pl-4">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{session.branchName}</span>
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {!isTerminal && (
              <Button
                variant="ghost"
                size="xs"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                disabled={isPending}
                onClick={handleArchive}
                title="归档"
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
              </Button>
            )}
            {session.status === 'archived' && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                  disabled={isPending}
                  onClick={handleRestore}
                  title="恢复"
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  onClick={handleDelete}
                  title="删除"
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>彻底删除会话</DialogTitle>
            <DialogDescription>
              将删除 Worktree 目录（
              <span className="font-mono text-foreground">.agent-worktrees/{session.id}</span>
              ）和分支（
              <span className="font-mono text-foreground">{session.branchName}</span>
              ），此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteSession(session.id)
                setConfirmDelete(false)
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function SessionSidebar() {
  const sessions = useSessionStore(s => s.sessions)
  const openCreateDialog = useSessionStore(s => s.openCreateDialog)
  const activeTabId = useSessionStore(s => s.activeTabId)

  return (
    <aside className="flex h-full w-full flex-col bg-panel">
      <div className="flex h-full w-full flex-col">
        {/* Header */}
        <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-2 gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            会话列表
          </span>
          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
            {sessions.length}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="h-6 w-6 p-0"
            onClick={() => openCreateDialog()}
            title="添加会话"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {sessions.map(session => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeTabId}
            />
          ))}
        </div>
      </div>
    </aside>
  )
}
