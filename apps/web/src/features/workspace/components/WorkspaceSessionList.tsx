import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { toastError } from '@/shared/lib/toast'
import { apiClient } from '@/shared/lib/api-client'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import { useUIStore } from '@/shared/stores/ui-store'
import { SessionItem, MainSessionItem } from '@/features/session/components/SessionListItems'
import { SessionContextMenu } from '@/features/layout/components/SessionContextMenu'
import { SwitchBranchDialog } from '@/features/session/components/SwitchBranchDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/components/ui/context-menu'
import { Button } from '@/shared/components/ui/button'
import { Folder, FolderOpen, Plus, Pin, Trash2 } from 'lucide-react'
import type { AgentSession } from '@akari/shared-types'

export function WorkspaceSessionList() {
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const currentWorkspace = useWorkspaceStore(s => s.currentWorkspace)
  const activateWorkspace = useWorkspaceStore(s => s.activateWorkspace)
  const deleteWorkspace = useWorkspaceStore(s => s.deleteWorkspace)
  const pinWorkspace = useWorkspaceStore(s => s.pinWorkspace)
  const activeSessionId = useNavigationStore(s => s.sessionId)
  const selectSession = useNavigationStore(s => s.selectSession)
  const workspaceSessions = useWorkspaceStore(s => s.workspaceSessions)
  const setWorkspaceSessions = useWorkspaceStore(s => s.setWorkspaceSessions)
  const openCreateDialog = useUIStore(s => s.openCreateDialog)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(currentWorkspace?.id ? [currentWorkspace.id] : []),
  )
  const [initialLoading, setInitialLoading] = useState(true)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [switchBranchDialog, setSwitchBranchDialog] = useState<{ open: boolean; sessionId: string | null }>({
    open: false,
    sessionId: null,
  })

  useEffect(() => {
    if (currentWorkspace?.id) {
      setExpandedIds(prev => {
        if (prev.has(currentWorkspace.id)) return prev
        return new Set([...prev, currentWorkspace.id])
      })
    }
  }, [currentWorkspace?.id])

  // 一次性并行拉取所有工作区的会话（会话是轻量元数据，无需按展开状态懒加载），写入 workspace-store
  useEffect(() => {
    let cancelled = false
    setInitialLoading(true)
    Promise.all(
      workspaces.map(async w => {
        try {
          const sessions = await apiClient.get<AgentSession[]>('/sessions', { workspaceId: w.id, toast: false })
          return [w.id, sessions] as const
        } catch (err) {
          // 单个工作区加载失败降级为空列表，不阻断其他工作区渲染
          console.error(`[WorkspaceSessionList] load sessions for ${w.id} failed:`, err)
          return [w.id, []] as const
        }
      }),
    ).then(entries => {
      if (cancelled) return
      setWorkspaceSessions(Object.fromEntries(entries))
      setInitialLoading(false)
    })
    return () => { cancelled = true }
  }, [workspaces, setWorkspaceSessions])

  const toggleExpand = useCallback((workspaceId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(workspaceId)) {
        next.delete(workspaceId)
      } else {
        next.add(workspaceId)
      }
      return next
    })
  }, [])

  const handleSelectSession = useCallback((session: AgentSession) => {
    if (session.workspaceId === currentWorkspace?.id) {
      selectSession(session.id)
      return
    }
    void activateWorkspace(session.workspaceId, session.id)
  }, [currentWorkspace?.id, selectSession, activateWorkspace])

  const handleNewSession = useCallback(async (workspaceId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (workspaceId !== currentWorkspace?.id) {
      await activateWorkspace(workspaceId)
    }
    openCreateDialog()
  }, [currentWorkspace?.id, activateWorkspace, openCreateDialog])

  const handleOpenExplorer = useCallback(async (path: string) => {
    const openPath = window.electron?.shell?.openPath
    if (!openPath) return
    const error = await openPath(path)
    if (error) {
      toastError(`打开资源管理器失败：${error}`)
    }
  }, [])

  const handlePin = useCallback(async (workspaceId: string) => {
    await pinWorkspace(workspaceId)
  }, [pinWorkspace])

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingWorkspaceId) return
    const id = deletingWorkspaceId
    setDeletingWorkspaceId(null)
    await deleteWorkspace(id)
  }, [deletingWorkspaceId, deleteWorkspace])

  const allSessions = Object.values(workspaceSessions).flat()
  const allArchivedSessions = allSessions.filter(s => !s.isMain && s.status === 'archived')

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string) => {
    const session = allSessions.find(s => s.id === sessionId)
    if (session?.workspaceId !== currentWorkspace?.id) return
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId })
  }, [allSessions, currentWorkspace?.id])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleOpenSwitchBranch = useCallback(() => {
    if (!contextMenu?.sessionId) return
    setSwitchBranchDialog({ open: true, sessionId: contextMenu.sessionId })
  }, [contextMenu?.sessionId])

  const ctxSession = contextMenu ? allSessions.find(s => s.id === contextMenu.sessionId) : null
  const switchBranchSession = switchBranchDialog.sessionId
    ? allSessions.find(s => s.id === switchBranchDialog.sessionId) ?? null
    : null

  const deletingWorkspace = deletingWorkspaceId
    ? workspaces.find(w => w.id === deletingWorkspaceId) ?? null
    : null

  const canOpenExplorer = typeof window !== 'undefined' && !!window.electron?.shell?.openPath

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center gap-2 px-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            项目
          </span>
          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
            {workspaces.length}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
          {workspaces.map((workspace) => {
            const isExpanded = expandedIds.has(workspace.id)
            const sessions = workspaceSessions[workspace.id] ?? []
            const isLoading = initialLoading && !(workspace.id in workspaceSessions)

            const mainSession = sessions.find(s => s.isMain)
            const regularSessions = sessions.filter(s => !s.isMain)
            const activeSessions = regularSessions.filter(s => s.status !== 'archived')

            return (
              <ContextMenu key={workspace.id}>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => toggleExpand(workspace.id)}
                    className="group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-normal text-foreground transition-none hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                    title={`${workspace.name}\n${workspace.path}`}
                  >
                    <Folder className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>

                    <div className="flex items-center gap-1 shrink-0">
                      {workspace.pinned && (
                        <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      {isLoading && (
                        <span className="text-[10px] text-muted-foreground">加载中...</span>
                      )}
                      <Button
                        asChild
                        variant="ghost"
                        size="xs"
                        className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                        title="新建会话"
                      >
                        <span
                          onClick={(e) => handleNewSession(workspace.id, e)}
                          role="button"
                          tabIndex={0}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </span>
                      </Button>
                    </div>
                  </button>
                </ContextMenuTrigger>

                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200 ease-out',
                    isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <div
                    className={cn(
                      'min-h-0 transition-opacity duration-200',
                      isExpanded ? 'overflow-visible opacity-100' : 'overflow-hidden opacity-0',
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mt-0.5 space-y-0.5 pl-2">
                      {mainSession && (
                        <MainSessionItem
                          session={mainSession}
                          isActive={mainSession.id === activeSessionId}
                          onContextMenu={handleContextMenu}
                          onClick={() => handleSelectSession(mainSession)}
                        />
                      )}

                      {activeSessions.map(session => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          isActive={session.id === activeSessionId}
                          onContextMenu={handleContextMenu}
                          onClick={() => handleSelectSession(session)}
                        />
                      ))}

                      {!isLoading && !mainSession && activeSessions.length === 0 && (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          暂无会话
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <ContextMenuContent className="w-44">
                  <ContextMenuLabel className="text-[11px]">{workspace.name}</ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handlePin(workspace.id)}>
                    <Pin className="mr-2 h-3.5 w-3.5" />
                    {workspace.pinned ? '取消置顶' : '置顶'}
                  </ContextMenuItem>
                  {canOpenExplorer && (
                    <ContextMenuItem onClick={() => handleOpenExplorer(workspace.path)}>
                      <FolderOpen className="mr-2 h-3.5 w-3.5" />
                      打开资源管理器
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => setDeletingWorkspaceId(workspace.id)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    移除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}

          {allArchivedSessions.length > 0 && (
            <>
              <div className="mt-2 flex h-7 items-center px-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  归档
                </span>
                <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                  {allArchivedSessions.length}
                </span>
              </div>
              {allArchivedSessions.map(session => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onContextMenu={handleContextMenu}
                  onClick={() => handleSelectSession(session)}
                />
              ))}
            </>
          )}

          {workspaces.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              暂无项目
            </div>
          )}
        </div>
      </div>

      {contextMenu && ctxSession && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          session={ctxSession}
          onClose={closeContextMenu}
          onSwitchBranch={handleOpenSwitchBranch}
        />
      )}

      <SwitchBranchDialog
        sessionId={switchBranchDialog.sessionId ?? ''}
        currentBranch={switchBranchSession?.branchName ?? ''}
        open={switchBranchDialog.open}
        onOpenChange={open => setSwitchBranchDialog(prev => ({ ...prev, open }))}
      />

      <Dialog open={!!deletingWorkspace} onOpenChange={open => !open && setDeletingWorkspaceId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">删除项目</DialogTitle>
            <DialogDescription className="text-[11px]">
              确定要删除项目「{deletingWorkspace?.name}」吗？该操作不会删除磁盘上的文件夹，仅移除 Akari 中的记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setDeletingWorkspaceId(null)}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={handleConfirmDelete}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
