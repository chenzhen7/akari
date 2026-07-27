import { useCallback, useEffect, useRef, useState } from 'react'
import { toastError } from '@/shared/lib/toast'
import { apiClient } from '@/shared/lib/api-client'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { useSessionStore } from '@/features/session/stores/session-store'
import { SessionItem, MainSessionItem } from '@/features/session/components/SessionListItems'
import { SessionContextMenu } from '@/features/layout/components/SessionContextMenu'
import { SwitchBranchDialog } from '@/features/session/components/SwitchBranchDialog'
import { selectFolder } from '@/shared/lib/native-file-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { ChevronDown, ChevronRight, Folder, Plus, Trash2 } from 'lucide-react'
import type { AgentSession } from '@akari/shared-types'

export function WorkspaceSessionList() {
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const currentWorkspace = useWorkspaceStore(s => s.currentWorkspace)
  const activateWorkspace = useWorkspaceStore(s => s.activateWorkspace)
  const deleteWorkspace = useWorkspaceStore(s => s.deleteWorkspace)
  const addWorkspace = useWorkspaceStore(s => s.addWorkspace)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const selectSession = useSessionStore(s => s.selectSession)

  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(currentWorkspace?.id ? [currentWorkspace.id] : []),
  )
  const [workspaceSessions, setWorkspaceSessions] = useState<Record<string, AgentSession[]>>({})
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const inFlightRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
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

  useEffect(() => {
    mountedRef.current = true

    async function loadSessions(workspaceId: string) {
      if (workspaceSessions[workspaceId] || inFlightRef.current.has(workspaceId)) return
      inFlightRef.current.add(workspaceId)
      setLoadingIds(prev => new Set(prev).add(workspaceId))
      try {
        const sessions = await apiClient.get<AgentSession[]>('/sessions', { workspaceId, toast: false })
        if (!mountedRef.current) return
        setWorkspaceSessions(prev => ({ ...prev, [workspaceId]: sessions }))
      } catch (err) {
        console.error(`[WorkspaceSessionList] load sessions for ${workspaceId} failed:`, err)
      } finally {
        inFlightRef.current.delete(workspaceId)
        if (mountedRef.current) {
          setLoadingIds(prev => {
            const next = new Set(prev)
            next.delete(workspaceId)
            return next
          })
        }
      }
    }

    for (const id of expandedIds) {
      void loadSessions(id)
    }

    return () => {
      mountedRef.current = false
    }
  }, [expandedIds])

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

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await selectFolder()
      if (!path) return
      const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
      const name = parts[parts.length - 1] || 'workspace'
      const workspace = await addWorkspace(name, path)
      if (workspace) {
        await activateWorkspace(workspace.id)
      }
    } catch (err) {
      toastError(`打开文件夹失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [addWorkspace, activateWorkspace])

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingWorkspaceId) return
    const id = deletingWorkspaceId
    setDeletingWorkspaceId(null)
    await deleteWorkspace(id)
  }, [deletingWorkspaceId, deleteWorkspace])

  const allSessions = Object.values(workspaceSessions).flat()

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

  const hasNativeDialog = typeof window !== 'undefined' && !!window.electron?.dialog?.showOpenDialog

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center gap-2 px-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            工作区
          </span>
          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
            {workspaces.length}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
          {workspaces.map((workspace) => {
            const isActive = workspace.id === currentWorkspace?.id
            const isExpanded = expandedIds.has(workspace.id)
            const sessions = workspaceSessions[workspace.id] ?? []
            const isLoading = loadingIds.has(workspace.id)

            const mainSession = sessions.find(s => s.isMain)
            const regularSessions = sessions.filter(s => !s.isMain)
            const activeSessions = regularSessions.filter(s => s.status !== 'archived')
            const archivedSessions = regularSessions.filter(s => s.status === 'archived')

            return (
              <div key={workspace.id} className="rounded-lg border border-transparent">
                <button
                  onClick={() => toggleExpand(workspace.id)}
                  className="group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-normal text-foreground transition-none hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                  title={`${workspace.name}\n${workspace.path}`}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>

                  <div className="flex items-center gap-1 shrink-0">
                    {isLoading && (
                      <span className="text-[10px] text-muted-foreground">加载中...</span>
                    )}
                    {!isActive && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeletingWorkspaceId(workspace.id)
                        }}
                        title="删除工作区"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-0.5 space-y-0.5 pl-2"
                    onClick={(e) => e.stopPropagation()}
                  >
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

                    {archivedSessions.length > 0 && (
                      <>
                        <div className="flex h-7 items-center px-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            归档
                          </span>
                          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
                            {archivedSessions.length}
                          </span>
                        </div>
                        {archivedSessions.map(session => (
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

                    {!isLoading && !mainSession && activeSessions.length === 0 && archivedSessions.length === 0 && (
                      <div className="px-2 py-2 text-xs text-muted-foreground">
                        暂无会话
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {workspaces.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              暂无工作区
            </div>
          )}
        </div>

        {hasNativeDialog && (
          <div className="shrink-0 border-t border-border/50 p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2 rounded-lg px-2.5 text-sm font-normal text-foreground hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              onClick={handleOpenFolder}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span>打开文件夹...</span>
            </Button>
          </div>
        )}
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
            <DialogTitle className="text-sm">删除工作区</DialogTitle>
            <DialogDescription className="text-[11px]">
              确定要删除工作区「{deletingWorkspace?.name}」吗？该操作不会删除磁盘上的文件夹，仅移除 Akari 中的记录。
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
