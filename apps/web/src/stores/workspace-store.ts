import { create } from 'zustand'
import { toast } from 'sonner'
import type { Workspace, FsEntry } from '@akari/shared-types'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface WorkspaceStore {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null

  fetchWorkspaces: () => void
  addWorkspace: (name: string, path: string) => void
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

  addWorkspace: (name, path) => {
    fetch(`${API_BASE}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(body => Promise.reject(body?.error ?? r.statusText))
        return r.json()
      })
      .then((workspace: Workspace) => {
        set(state => ({ workspaces: [...state.workspaces, workspace] }))
        toast.success(`已添加工作区：${workspace.name}`)
      })
      .catch(err => {
        console.error('[addWorkspace] failed:', err)
        toast.error(`添加工作区失败：${err}`)
      })
  },

  switchWorkspace: (id) => {
    fetch(`${API_BASE}/workspaces/${id}/switch`, { method: 'POST' })
      .then(r => {
        if (!r.ok) return r.json().then(body => Promise.reject(body?.error ?? r.statusText))
      })
      .catch(err => {
        console.error('[switchWorkspace] failed:', err)
        toast.error(`切换工作区失败：${err}`)
      })
  },

  deleteWorkspace: (id) => {
    fetch(`${API_BASE}/workspaces/${id}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) return r.json().then(body => Promise.reject(body?.error ?? r.statusText))
        set(state => ({ workspaces: state.workspaces.filter(w => w.id !== id) }))
      })
      .catch(err => {
        console.error('[deleteWorkspace] failed:', err)
        toast.error(`删除工作区失败：${err}`)
      })
  },

  setCurrentWorkspace: (workspace) => {
    set({ currentWorkspace: workspace })
  },
}))
