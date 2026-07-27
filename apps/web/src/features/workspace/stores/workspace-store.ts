import { create } from 'zustand'
import { toast, toastError } from '@/shared/lib/toast'
import { apiClient } from '@/shared/lib/api-client'
import { useWindowStore } from '@/shared/stores/window-store'
import { useSessionStore } from '@/features/session/stores/session-store'
import type { Workspace, AgentSession } from '@akari/shared-types'

interface WorkspaceStore {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null

  fetchWorkspaces: () => void
  addWorkspace: (name: string, path: string) => Promise<Workspace | undefined>
  activateWorkspace: (id: string, sessionId?: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  setCurrentWorkspace: (workspace: Workspace) => void
}

export function mergeWorkspaces(prev: Workspace[], next: Workspace[]): Workspace[] {
  const nextById = new Map(next.map(w => [w.id, w]))
  const merged: Workspace[] = []

  // 保留当前顺序
  for (const w of prev) {
    const updated = nextById.get(w.id)
    if (updated) {
      merged.push(updated)
      nextById.delete(w.id)
    }
  }

  // 新项目追加到末尾
  for (const w of next) {
    if (nextById.has(w.id)) {
      merged.push(w)
    }
  }

  return merged
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,

  fetchWorkspaces: () => {
    apiClient.get<Workspace[]>('/workspaces', { toast: false })
      .then((workspaces) => {
        const merged = mergeWorkspaces(get().workspaces, workspaces)
        const nextCurrent = get().currentWorkspace
        const stillExists = nextCurrent && merged.some(w => w.id === nextCurrent.id)
        set({
          workspaces: merged,
          currentWorkspace: stillExists ? nextCurrent : (merged[0] ?? null),
        })
      })
      .catch(err => {
        console.error('[fetchWorkspaces] failed:', err)
        toastError(`加载项目失败：${err instanceof Error ? err.message : String(err)}`)
      })
  },

  addWorkspace: async (name, path) => {
    try {
      const workspace = await apiClient.post<Workspace | null>('/workspaces', { name, path }, { toast: false })
      toast.success(`已添加项目：${workspace?.name ?? name}`)
      return workspace ?? undefined
    } catch (err) {
      toastError(`添加项目失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  },

  activateWorkspace: async (id, sessionId) => {
    const currentWorkspaceId = useWindowStore.getState().workspaceId
    if (id === currentWorkspaceId && !sessionId) {
      return
    }

    const workspace = get().workspaces.find(w => w.id === id)
    if (!workspace) {
      console.error(`[activateWorkspace] workspace ${id} not found in local list`)
      return
    }

    set({ currentWorkspace: workspace })
    useSessionStore.getState().resetForWorkspace()
    useWindowStore.getState().setWorkspaceId(id)

    const params = new URLSearchParams(window.location.search)
    params.set('workspaceId', id)
    history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)

    if (window.electron?.workspace?.setActiveWorkspaceId) {
      void window.electron.workspace.setActiveWorkspaceId(id)
    }

    try {
      const [sessions] = await Promise.all([
        apiClient.get<AgentSession[]>('/sessions', { workspaceId: id, toast: false }),
        apiClient.post(`/workspaces/${id}/activate`, undefined, { toast: '切换项目失败' }),
      ])
      useSessionStore.getState().setSessions(sessions)
      if (sessionId) {
        useSessionStore.getState().selectSession(sessionId)
      }
    } catch (err) {
      console.error('[activateWorkspace] failed:', err)
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await apiClient.delete(`/workspaces/${id}`, { toast: '删除项目失败' })
      if (window.electron?.workspace?.notifyDeleted) {
        void window.electron.workspace.notifyDeleted(id)
      }

      const remaining = get().workspaces.filter(w => w.id !== id)
      if (get().currentWorkspace?.id === id) {
        useSessionStore.getState().resetForWorkspace()
        if (remaining.length > 0) {
          await get().activateWorkspace(remaining[0].id)
        } else {
          set({ currentWorkspace: null })
          useWindowStore.getState().setWorkspaceId(null)
          history.replaceState(null, '', window.location.pathname)
        }
      }
    } catch (err) {
      console.error('[deleteWorkspace] failed:', err)
    }
  },

  setCurrentWorkspace: (workspace) => {
    set({ currentWorkspace: workspace })
  },
}))
