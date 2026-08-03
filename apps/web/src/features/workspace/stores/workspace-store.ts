import { create } from 'zustand'
import { toast, toastError } from '@/shared/lib/toast'
import { apiClient } from '@/shared/lib/api-client'
import { useWindowStore } from '@/shared/stores/window-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import type { Workspace, AgentSession } from '@akari/shared-types'

interface WorkspaceStore {
  workspaces: Workspace[]
  currentWorkspace: Workspace | null
  workspaceSessions: Record<string, AgentSession[]>

  fetchWorkspaces: () => void
  addWorkspace: (name: string, path: string) => Promise<Workspace | undefined>
  activateWorkspace: (id: string, sessionId?: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  pinWorkspace: (id: string) => Promise<void>
  setCurrentWorkspace: (workspace: Workspace) => void
  setWorkspaceSessions: (sessions: Record<string, AgentSession[]>) => void
  updateSession: (sessionId: string, patch: Partial<AgentSession>) => void
  removeSession: (sessionId: string) => void
  addSession: (session: AgentSession) => void
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

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  return {
    workspaces: [],
    currentWorkspace: null,
    workspaceSessions: {},

    fetchWorkspaces: () => {
      apiClient.get<Workspace[]>('/workspaces', { toast: false })
        .then((workspaces) => {
          const merged = mergeWorkspaces(get().workspaces, workspaces)
          const nextCurrent = get().currentWorkspace
          const updatedCurrent = nextCurrent ? merged.find(w => w.id === nextCurrent.id) ?? null : null
          set({
            workspaces: merged,
            currentWorkspace: updatedCurrent ?? (merged[0] ?? null),
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
      useWindowStore.getState().setWorkspaceId(id)

      // 一次性设置导航选中态（目标会话优先，否则回退第一个），数据来自已就绪的全量缓存，
      // 无 setSessions 兜底、无中间态，切换项目时 sidebar 不闪烁、选中不被 sessions:list 覆盖
      const cachedIds = (get().workspaceSessions[id] ?? []).map(s => s.id)
      useNavigationStore.getState().selectWorkspaceSession(sessionId ?? null, cachedIds)

      const params = new URLSearchParams(window.location.search)
      params.set('workspaceId', id)
      history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)

      if (window.electron?.workspace?.setActiveWorkspaceId) {
        void window.electron.workspace.setActiveWorkspaceId(id)
      }

      try {
        await apiClient.post(`/workspaces/${id}/activate`, undefined, { toast: '切换项目失败' })
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
        set(state => ({
          workspaces: remaining,
          workspaceSessions: Object.fromEntries(
            Object.entries(state.workspaceSessions).filter(([wsId]) => wsId !== id)
          ),
        }))
        if (get().currentWorkspace?.id === id) {
          if (remaining.length > 0) {
            await get().activateWorkspace(remaining[0].id)
          } else {
            set({ currentWorkspace: null })
            useNavigationStore.getState().setViewMode(null)
            useWindowStore.getState().setWorkspaceId(null)
            history.replaceState(null, '', window.location.pathname)
          }
        }
      } catch (err) {
        console.error('[deleteWorkspace] failed:', err)
      }
    },

    pinWorkspace: async (id) => {
      const workspace = get().workspaces.find(w => w.id === id)
      if (!workspace) return

      const nextPinned = !workspace.pinned
      try {
        await apiClient.patch(`/workspaces/${id}/pin`, { pinned: nextPinned }, { toast: nextPinned ? '置顶失败' : '取消置顶失败' })
        const reordered = [...get().workspaces]
          .map(w => w.id === id ? { ...w, pinned: nextPinned } : w)
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned)
            return b.lastOpenedAt.getTime() - a.lastOpenedAt.getTime()
          })
        const nextCurrent = get().currentWorkspace
        set({
          workspaces: reordered,
          currentWorkspace: nextCurrent && nextCurrent.id === id ? { ...nextCurrent, pinned: nextPinned } : nextCurrent,
        })
      } catch (err) {
        console.error('[pinWorkspace] failed:', err)
      }
    },

    setCurrentWorkspace: (workspace) => {
      set({ currentWorkspace: workspace })
    },

    setWorkspaceSessions: (workspaceSessions) => {
      set({ workspaceSessions })
    },

    updateSession: (sessionId, patch) => {
      set(state => {
        const next: Record<string, AgentSession[]> = {}
        let changed = false
        for (const [wsId, sessions] of Object.entries(state.workspaceSessions)) {
          let listChanged = false
          const updated = sessions.map(s => {
            if (s.id !== sessionId) return s
            listChanged = true
            changed = true
            return { ...s, ...patch }
          })
          // 未变化的工作区复用原数组引用，避免订阅了当前工作区列表的组件被无关更新触发重渲染
          next[wsId] = listChanged ? updated : sessions
        }
        return changed ? { workspaceSessions: next } : state
      })
    },

    removeSession: (sessionId) => {
      set(state => {
        const next: Record<string, AgentSession[]> = {}
        let changed = false
        for (const [wsId, sessions] of Object.entries(state.workspaceSessions)) {
          const filtered = sessions.filter(s => s.id !== sessionId)
          if (filtered.length !== sessions.length) {
            changed = true
            next[wsId] = filtered
          } else {
            // 未变化的工作区复用原数组引用
            next[wsId] = sessions
          }
        }
        return changed ? { workspaceSessions: next } : state
      })
    },

    addSession: (session) => {
      set(state => {
        const sessions = state.workspaceSessions[session.workspaceId] ?? []
        if (sessions.some(s => s.id === session.id)) return state
        return {
          workspaceSessions: {
            ...state.workspaceSessions,
            [session.workspaceId]: [...sessions, session],
          },
        }
      })
    },
  }
})
