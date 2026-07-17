import { create } from 'zustand'
import { toast, toastError } from '@/lib/toast'
import { apiClient } from '@/lib/api-client'
import type { Workspace } from '@akari/shared-types'

interface WorkspaceStore {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null

  fetchWorkspaces: () => void
  addWorkspace: (name: string, path: string) => Promise<Workspace | undefined>
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  setCurrentWorkspace: (workspace: Workspace) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspaces: [],
  currentWorkspace: null,

  fetchWorkspaces: () => {
    apiClient.get<Workspace[]>('/workspaces', { toast: false })
      .then((workspaces) => {
        set({ workspaces })
        const current = workspaces.find(w => w.isCurrent)
        if (current) {
          set({ currentWorkspace: current })
        }
      })
      .catch(err => console.warn('[fetchWorkspaces] failed:', err))
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

  switchWorkspace: (id) => {
    apiClient.post(`/workspaces/${id}/switch`, undefined, { toast: '切换工作区失败' })
      .catch((err) => {
        console.error('[switchWorkspace] failed:', err)
      })
  },

  deleteWorkspace: (id) => {
    apiClient.delete(`/workspaces/${id}`, { toast: '删除工作区失败' })
      .catch((err) => {
        console.error('[deleteWorkspace] failed:', err)
      })
  },

  setCurrentWorkspace: (workspace) => {
    set({ currentWorkspace: workspace })
  },
}))
