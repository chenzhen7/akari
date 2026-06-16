import { memo, useCallback, useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionStore, CANVAS_ENABLED } from '@/stores/session-store'
import { Button } from '@/components/ui/button'
import {
  GitBranch,
  Plus,
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
  Settings,
  LayoutGrid,
  Columns3,
  type LucideIcon,
} from 'lucide-react'
import type { AgentSession } from '@/types'
import { DeleteSessionDialog } from '@/components/session/DeleteSessionDialog'
import { SessionContextMenu } from './SessionContextMenu'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector'

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
  const { Icon, color } = statusIconMap[status] ?? statusIconMap.initializing
  const isSpinning = status === 'running' || status === 'initializing'
  return <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', color, isSpinning && 'animate-spin')} />
}

interface SessionItemProps {
  session: AgentSession
  isActive: boolean
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
}

const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onContextMenu,
}: SessionItemProps) {
  const selectSession = useSessionStore(s => s.selectSession)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const isPending = useSessionStore(s => s.pendingOps.has(session.id))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isTerminal = ['archived', 'merged'].includes(session.status)
  const additions = session.diffSummary?.additions ?? 0
  const deletions = session.diffSummary?.deletions ?? 0
  const isMain = session.isMain ?? false

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
        onClick={() => selectSession(session.id)}
        onContextMenu={handleContextMenu}
        className={cn(
          'group flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
          isActive
            ? 'bg-zinc-200 text-foreground hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-700'
            : 'text-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700',
        )}
      >
        {/* 第一行：状态 + 名称 + 右上角 diff */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <StatusIcon status={session.status} />
            <p className="truncate text-xs font-medium">
              {session.name}
            </p>
            {isMain && (
              <span className="flex h-3 items-center text-xs text-muted-foreground shrink-0">*</span>
            )}
          </div>
          {(additions > 0 || deletions > 0) && (
            <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
              {additions > 0 && <span className="text-green-500">+{additions}</span>}
              {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
            </div>
          )}
        </div>

        {/* 第二行：task 描述 / branch + 右下角操作按钮 */}
        <div className="flex items-center justify-between gap-1 pl-4">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
            {session.task ? (
              <span className="truncate">{session.task}</span>
            ) : (
              <>
                <GitBranch className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{session.branchName}</span>
                {!isMain && (
                  <>
                    <span className="opacity-50 shrink-0">→</span>
                    <span className="truncate">{session.baseBranch}</span>
                  </>
                )}
              </>
            )}
          </div>
          {isMain ? (
            <div className="h-6 shrink-0" />
          ) : (
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
          )}
        </div>
      </button>

      {!isMain && (
        <DeleteSessionDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          sessionId={session.id}
          branchName={session.branchName}
          worktreePath={session.worktreePath}
          onConfirm={() => deleteSession(session.id)}
        />
      )}
    </>
  )
})

interface SidebarActionButtonProps {
  icon: LucideIcon
  label: string
  active?: boolean
  shortcut?: string
  onClick: () => void
}

function SidebarActionButton({ icon: Icon, label, active, shortcut, onClick }: SidebarActionButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-8 w-full justify-between rounded-lg px-2.5 text-sm font-normal transition-none',
        active
          ? 'bg-zinc-200 text-zinc-900 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-100'
          : 'text-foreground hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100',
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      {shortcut && (
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-sans text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Button>
  )
}

function SidebarActions() {
  const globalViewMode = useSessionStore(s => s.globalViewMode)
  const setGlobalViewMode = useSessionStore(s => s.setGlobalViewMode)
  const openCreateDialog = useSessionStore(s => s.openCreateDialog)

  return (
    <div className="space-y-0.5 border-b border-border/50 p-2">
      <WorkspaceSelector />
      <SidebarActionButton
        icon={Plus}
        label="新建会话"
  
        onClick={() => openCreateDialog()}
      />
      {CANVAS_ENABLED && (
        <SidebarActionButton
          icon={LayoutGrid}
          label="画布"
          active={globalViewMode === 'canvas'}
          onClick={() => setGlobalViewMode('canvas')}
        />
      )}
      <SidebarActionButton
        icon={Columns3}
        label="看板"
        active={globalViewMode === 'kanban'}
        onClick={() => setGlobalViewMode('kanban')}
      />
    </div>
  )
}

export function SessionSidebar() {
  const sessions = useSessionStore(s => s.sessions)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const mainSession = sessions.find(s => s.isMain)
  const regularSessions = sessions.filter(s => !s.isMain)
  const activeSessions = regularSessions.filter(s => s.status !== 'archived')
  const archivedSessions = regularSessions.filter(s => s.status === 'archived')

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const ctxSession = contextMenu ? sessions.find(s => s.id === contextMenu.sessionId) : null

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-panel">
        <div className="flex h-full w-full flex-col">
          <SidebarActions />

          {/* Header */}
          <div className="flex h-9 shrink-0 items-center gap-2 px-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              会话列表
            </span>
            <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
              {activeSessions.length}
            </span>
          </div>

          {/* Main session */}
          {mainSession && (
            <div className="px-2 pt-1">
              <SessionItem
                session={mainSession}
                isActive={mainSession.id === activeSessionId}
                onContextMenu={handleContextMenu}
              />
            </div>
          )}

    

          {/* Active session list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
            {activeSessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>

          {/* Archived list */}
          {archivedSessions.length > 0 && (
            <>
              <div className="flex h-7 shrink-0 items-center px-2 gap-2 border-t border-border/50">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  归档
                </span>
                <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                  {archivedSessions.length}
                </span>
              </div>
              <div className="shrink-0 overflow-y-auto p-2 space-y-0.5 max-h-[35%]">
                {archivedSessions.map(session => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onContextMenu={handleContextMenu}
                  />
                ))}
              </div>
            </>
          )}

          {/* Footer: Settings */}
          <div className="flex h-8 shrink-0 items-center justify-end  border-border/50 px-2">
            <Button
              variant="ghost"
              size="xs"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setSettingsOpen(true)}
              title="设置"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {contextMenu && ctxSession && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          session={ctxSession}
          onClose={closeContextMenu}
        />
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
