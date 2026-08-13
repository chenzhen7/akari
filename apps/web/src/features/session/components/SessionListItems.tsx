import { memo, useCallback, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { useSessionStore } from '@/features/session/stores/session-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { Button } from '@/shared/components/ui/button'
import {
  GitBranch,
  Archive,
  Trash2,
  RotateCcw,
  Loader2,
  Coffee,
  Clock,
  XCircle,
  CheckCircle2,
  PauseCircle,
  Eye,
  type LucideIcon,
} from 'lucide-react'
import type { AgentSession } from '@/shared/types'
import { DeleteSessionDialog } from '@/features/session/components/DeleteSessionDialog'

/** 会话 diff 合计：优先按 diffFiles 求和（与变更列表同源），未加载时回退 DB 里的 diffSummary */
function sessionDiffTotals(session: AgentSession): { additions: number; deletions: number } {
  if (session.diffFiles) {
    return session.diffFiles.reduce(
      (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
      { additions: 0, deletions: 0 },
    )
  }
  return { additions: session.diffSummary?.additions ?? 0, deletions: session.diffSummary?.deletions ?? 0 }
}

const statusIconMap: Record<string, { Icon: LucideIcon; color: string }> = {
  running: { Icon: Loader2, color: 'text-green-500' },
  idle: { Icon: Coffee, color: 'text-sky-500' },
  waiting: { Icon: Clock, color: 'text-amber-500' },
  failed: { Icon: XCircle, color: 'text-red-500' },
  completed: { Icon: CheckCircle2, color: 'text-blue-500' },
  initializing: { Icon: Loader2, color: 'text-slate-400' },
  paused: { Icon: PauseCircle, color: 'text-orange-500' },
  review: { Icon: Eye, color: 'text-purple-500' },
  archived: { Icon: Archive, color: 'text-slate-500' },
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'idle') {
    return <div className="mt-0.5 h-3 w-3 shrink-0" />
  }
  const { Icon, color } = statusIconMap[status] ?? statusIconMap.initializing
  const isSpinning = status === 'running' || status === 'initializing'
  return <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', color, isSpinning && 'animate-spin')} />
}

function SessionDiffBadge({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
      {additions > 0 && <span className="text-green-500">+{additions}</span>}
      {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
    </div>
  )
}

interface SessionItemProps {
  session: AgentSession
  isActive: boolean
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
  onClick?: () => void
}

export const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onContextMenu,
  onClick,
}: SessionItemProps) {
  const selectSession = useNavigationStore(s => s.selectSession)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const isPending = useSessionStore(s => s.pendingOps.has(session.id))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isTerminal = ['archived', 'merged'].includes(session.status)
  const { additions, deletions } = sessionDiffTotals(session)

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    archiveSession(session.id)
  }, [archiveSession, session.id])

  const handleRestore = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    restoreSession(session.id)
  }, [restoreSession, session.id])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDelete(true)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    onContextMenu(e, session.id)
  }, [onContextMenu, session.id])

  return (
    <>
      <button
        onClick={onClick ?? (() => selectSession(session.id))}
        onContextMenu={handleContextMenu}
        className={cn(
          'group flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
          isActive
            ? 'bg-zinc-200 text-foreground hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-700'
            : 'text-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <StatusIcon status={session.status} />
            <p className="truncate text-sm font-medium">{session.name}</p>
          </div>
          {(additions > 0 || deletions > 0) && <SessionDiffBadge additions={additions} deletions={deletions} />}
        </div>

        <div className="flex items-center justify-between gap-1 pl-4">
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{session.branchName}</span>
            <span className="opacity-50 shrink-0">→</span>
            <span className="truncate">{session.baseBranch}</span>
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

      <DeleteSessionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        sessionId={session.id}
        branchName={session.branchName}
        worktreePath={session.worktreePath}
        onConfirm={() => deleteSession(session.id)}
      />
    </>
  )
})

interface MainSessionItemProps {
  session: AgentSession
  isActive: boolean
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
  onClick?: () => void
}

export const MainSessionItem = memo(function MainSessionItem({
  session,
  isActive,
  onContextMenu,
  onClick,
}: MainSessionItemProps) {
  const selectSession = useNavigationStore(s => s.selectSession)
  const initGit = useWorkspaceStore(s => s.initGit)
  const [initializingGit, setInitializingGit] = useState(false)
  const { additions, deletions } = sessionDiffTotals(session)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    onContextMenu(e, session.id)
  }, [onContextMenu, session.id])

  /** 非 git 主会话：点击直接初始化（git init，不自动提交），初始化中阻止重复触发 */
  const handleInitGit = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
    if (!session.workspaceId || initializingGit) return
    setInitializingGit(true)
    initGit(session.workspaceId).finally(() => setInitializingGit(false))
  }, [initGit, session.workspaceId, initializingGit])

  return (
    <button
      onClick={onClick ?? (() => selectSession(session.id))}
      onContextMenu={handleContextMenu}
      className={cn(
        'group flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
        isActive
          ? 'bg-zinc-200 text-foreground hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-700'
          : 'text-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <StatusIcon status={session.status} />
          <p className="truncate text-sm">{session.name}</p>
          <span className="flex h-3 items-center text-xs text-muted-foreground shrink-0">*</span>
        </div>
        {(additions > 0 || deletions > 0) && <SessionDiffBadge additions={additions} deletions={deletions} />}
      </div>

      <div className="flex items-center justify-between gap-1 pl-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
          <GitBranch className="h-2.5 w-2.5 shrink-0" />
          {session.branchName ? (
            <span className="truncate">{session.branchName}</span>
          ) : (
            <span
              role="button"
              tabIndex={0}
              onClick={handleInitGit}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleInitGit(e)
                }
              }}
              title="初始化 Git 仓库（仅执行 git init，不自动提交）"
              className={cn(
                'truncate font-medium text-sky-600 hover:underline dark:text-sky-400',
                initializingGit && 'cursor-default opacity-60',
              )}
            >
              {initializingGit ? '初始化 Git 仓库…' : '初始化 Git 仓库'}
            </span>
          )}
        </div>
        <div className="h-6 shrink-0" />
      </div>
    </button>
  )
})
