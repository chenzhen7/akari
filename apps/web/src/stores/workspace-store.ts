import { create } from 'zustand'
import { toast, toastError } from '@/lib/toast'
import type { Workspace } from '@akari/shared-types'
import { API_BASE } from '@/lib/api'

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
    fetch(`${API_BASE}/workspaces`)
      .then(r => r.json())
      .then((workspaces: Workspace[]) => {
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
      const r = await fetch(`${API_BASE}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body?.error ?? r.statusText)
      }
      const workspace = (await r.json()) as Workspace
      toast.success(`已添加工作区：${workspace.name}`)
      return workspace
    } catch (err) {
      console.error('[addWorkspace] failed:', err)
      toastError(`添加工作区失败：${err instanceof Error ? err.message : String(err)}`)
      return undefined
    }
  },

  switchWorkspace: (id) => {
    fetch(`${API_BASE}/workspaces/${id}/switch`, { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? r.statusText)
        }
      })
      .catch((err) => {
        console.error('[switchWorkspace] failed:', err)
        toastError(`切换工作区失败：${err instanceof Error ? err.message : String(err)}`)
      })
  },

  deleteWorkspace: (id) => {
    fetch(`${API_BASE}/workspaces/${id}`, { method: 'DELETE' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? r.statusText)
        }
      })
      .catch((err) => {
        console.error('[deleteWorkspace] failed:', err)
        toastError(`删除工作区失败：${err instanceof Error ? err.message : String(err)}`)
      })
  },

  setCurrentWorkspace: (workspace) => {
    set({ currentWorkspace: workspace })
  },
}))
