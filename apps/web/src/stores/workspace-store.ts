import { create } from 'zustand'
import { toast } from 'sonner'
import type { Workspace, FsEntry } from '@akari/shared-types'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface WorkspaceStore {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  fileBrowserOpen: boolean
  fileBrowserPath: string
  fileBrowserEntries: FsEntry[]
  fileBrowserSelectedPath: string | null
  fileBrowserLoading: boolean

  fetchWorkspaces: () => void
  addWorkspace: (name: string, path: string) => void
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  setCurrentWorkspace: (workspace: Workspace) => void

  openFileBrowser: () => void
  closeFileBrowser: () => void
  navigateTo: (path: string) => void
  selectPath: (path: string | null) => void
  goUp: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,
  fileBrowserOpen: false,
  fileBrowserPath: '',
  fileBrowserEntries: [],
  fileBrowserSelectedPath: null,
  fileBrowserLoading: false,

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

  openFileBrowser: () => {
    set({ fileBrowserOpen: true, fileBrowserSelectedPath: null })
    get().navigateTo('')
  },

  closeFileBrowser: () => {
    set({ fileBrowserOpen: false })
  },

  navigateTo: (path) => {
    set({ fileBrowserLoading: true, fileBrowserPath: path })
    const url = path
      ? `${API_BASE}/fs/list?path=${encodeURIComponent(path)}`
      : `${API_BASE}/fs/list`
    fetch(url)
      .then(r => r.json())
      .then((data: { entries: FsEntry[]; currentPath: string; parentPath: string | null }) => {
        set({
          fileBrowserEntries: data.entries,
          fileBrowserPath: data.currentPath,
          fileBrowserLoading: false,
        })
      })
      .catch(err => {
        console.error('[navigateTo] failed:', err)
        set({ fileBrowserLoading: false })
      })
  },

  selectPath: (path) => {
    set({ fileBrowserSelectedPath: path })
  },

  goUp: () => {
    const { fileBrowserPath } = get()
    if (!fileBrowserPath) return

    const normalized = fileBrowserPath.replace(/\\/g, '/')

    // Windows drive root (e.g. C:/ or C:) → go to drive list
    if (/^[A-Za-z]:\/?$/.test(normalized)) {
      get().navigateTo('')
      return
    }

    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) {
      get().navigateTo('')
      return
    }

    const parent = normalized.slice(0, lastSlash)
    // Parent is a drive root → normalize to trailing slash so the backend
    // consistently returns currentPath as "C:/" rather than "C:".
    if (/^[A-Za-z]:$/.test(parent)) {
      get().navigateTo(parent + '/')
      return
    }

    get().navigateTo(parent || '/')
  },
}))
