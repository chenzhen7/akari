import { memo, useCallback, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { useSessionStore } from '@/features/session/stores/session-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { Button } from '@/shared/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/shared/components/ui/hover-card'
import { sessionDiffTotals } from '@/features/session/lib/session-ui'
import { StatusIcon } from '@/features/session/components/SessionStatusIcon'
import { SessionHoverCard } from '@/features/session/components/SessionHoverCard'
import { GitBranch, Archive, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import type { AgentSession, AheadBehind } from '@/shared/types'
import { DeleteSessionDialog } from '@/features/session/components/DeleteSessionDialog'

/** 领先/落后徽标：仅在有上游且 ahead/behind 非全零时显示 `↓behind ↑ahead`（对齐 VS Code 语义） */
function AheadBehindBadge({ ab }: { ab: AheadBehind | null | undefined }) {
  if (!ab || (ab.ahead === 0 && ab.behind === 0)) return null
  return (
    <div className="flex shrink-0 items-center gap-1 text-[10px] font-mono">
      {ab.behind > 0 && <span className="text-amber-500">↓{ab.behind}</span>}
      {ab.ahead > 0 && <span className="text-sky-500">↑{ab.ahead}</span>}
    </div>
  )
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
      <HoverCard>
        <HoverCardTrigger asChild>
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
                <AheadBehindBadge ab={session.aheadBehind} />
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
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-80">
          <SessionHoverCard session={session} />
        </HoverCardContent>
      </HoverCard>

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
    <HoverCard>
      <HoverCardTrigger asChild>
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
                <>
                  <span className="truncate">{session.branchName}</span>
                  <AheadBehindBadge ab={session.aheadBehind} />
                </>
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
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-80">
        <SessionHoverCard session={session} />
      </HoverCardContent>
    </HoverCard>
  )
})
