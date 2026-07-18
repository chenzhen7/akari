import { create } from 'zustand'
import { toast, toastError } from '@/lib/toast'
import { apiClient } from '@/lib/api-client'
import type { Workspace } from '@akari/shared-types'

interface WorkspaceStore {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null

  fetchWorkspaces: () => void
  addWorkspace: (name: string, path: string) => Promise<Workspace | undefined>
  activateWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  setCurrentWorkspace: (workspace: Workspace) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,

  fetchWorkspaces: () => {
    apiClient.get<Workspace[]>('/workspaces', { toast: false })
      .then((workspaces) => {
        set({ workspaces })
        // If no workspace is currently selected, default to the most recently active one
        if (!get().currentWorkspace && workspaces.length > 0) {
          set({ currentWorkspace: workspaces[0] })
        }
      })
      .catch(err => {
        console.error('[fetchWorkspaces] failed:', err)
        toastError(`加载工作区失败：${err instanceof Error ? err.message : String(err)}`)
      })
  },

  addWorkspace: async (name, path) => {
    try {
      const workspace = await apiClient.post<Workspace | null>('/workspaces', { name, path }, { toast: false })
      toast.success(`已添加工作区：${workspace?.name ?? name}`)
      return workspace ?? undefined
    } catch (err) {
      toastError(`添加工作区失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  },

  activateWorkspace: (id) => {
    apiClient.post(`/workspaces/${id}/activate`, undefined, { toast: '切换工作区失败' })
      .catch((err) => {
        console.error('[activateWorkspace] failed:', err)
      })
  },

  deleteWorkspace: async (id) => {
    try {
      await apiClient.delete(`/workspaces/${id}`, { toast: '删除工作区失败' })
      if (window.electron?.workspace?.notifyDeleted) {
        void window.electron.workspace.notifyDeleted(id)
      }
    } catch (err) {
      console.error('[deleteWorkspace] failed:', err)
    }
  },

  setCurrentWorkspace: (workspace) => {
    set({ currentWorkspace: workspace })
  },
}))
