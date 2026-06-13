import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/session-store'
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
  type LucideIcon,
} from 'lucide-react'
import type { AgentSession } from '@/types'
import { DeleteSessionDialog } from '@/components/session/DeleteSessionDialog'
import { SessionContextMenu } from './SessionContextMenu'
import { SettingsDialog } from '@/components/settings/SettingsDialog'

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
  contextMenu: { x: number; y: number; sessionId: string } | null
  onContextMenu: (e: React.MouseEvent, sessionId: string) => void
  onCloseContextMenu: () => void
}

function SessionItem({ session, isActive, contextMenu, onContextMenu, onCloseContextMenu }: SessionItemProps) {
  const selectSession = useSessionStore(s => s.selectSession)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const pendingOps = useSessionStore(s => s.pendingOps)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isPending = pendingOps.has(session.id)
  const isTerminal = ['archived', 'merged'].includes(session.status)
  const additions = session.diffSummary?.additions ?? 0
  const deletions = session.diffSummary?.deletions ?? 0
  const isMain = session.isMain ?? false

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    onContextMenu(e, session.id)
  }

  return (
    <>
      <button
        onClick={() => selectSession(session.id)}
        onContextMenu={handleContextMenu}
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
            <StatusIcon status={session.status} />
            <p className={cn('truncate text-xs font-medium', isActive && 'text-primary')}>
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

        {/* 第二行：branchName + 右下角操作按钮 */}
        <div className="flex items-center justify-between gap-1 pl-4">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{session.branchName}</span>
            {!isMain && (
              <>
                <span className="opacity-50 shrink-0">→</span>
                <span className="truncate">{session.baseBranch}</span>
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
}

export function SessionSidebar() {
  const sessions = useSessionStore(s => s.sessions)
  const openCreateDialog = useSessionStore(s => s.openCreateDialog)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const mainSession = sessions.find(s => s.isMain)
  const regularSessions = sessions.filter(s => !s.isMain)
  const activeSessions = regularSessions.filter(s => s.status !== 'archived')
  const archivedSessions = regularSessions.filter(s => s.status === 'archived')

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }

  const closeContextMenu = () => setContextMenu(null)

  const ctxSession = contextMenu ? sessions.find(s => s.id === contextMenu.sessionId) : null

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-panel">
        <div className="flex h-full w-full flex-col">
          {/* Header */}
          <div className="flex h-9 shrink-0 items-center px-2 gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              会话列表
            </span>
            <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
              {activeSessions.length}
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

          {/* Main session */}
          {mainSession && (
            <div className="px-2 pt-1">
              <SessionItem
                session={mainSession}
                isActive={mainSession.id === activeSessionId}
                contextMenu={contextMenu}
                onContextMenu={handleContextMenu}
                onCloseContextMenu={closeContextMenu}
              />
            </div>
          )}

    

          {/* Active session list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
            {activeSessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                contextMenu={contextMenu}
                onContextMenu={handleContextMenu}
                onCloseContextMenu={closeContextMenu}
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
              <div className="shrink-0 overflow-y-auto p-2 space-y-1.5 max-h-[35%]">
                {archivedSessions.map(session => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    contextMenu={contextMenu}
                    onContextMenu={handleContextMenu}
                    onCloseContextMenu={closeContextMenu}
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
              className='h-6 w-6 p-0 text-muted-foreg round hover:text-foreground'
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
