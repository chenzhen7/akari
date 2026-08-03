import { create } from 'zustand'
import { toast, toastError } from '@/shared/lib/toast'
import { apiClient } from '@/shared/lib/api-client'
import { useWindowStore } from '@/shared/stores/window-store'
import { useSessionStore } from '@/features/session/stores/session-store'
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
  // 监听 session-store 的删除操作：后端 deleteSession 不广播事件，前端删除后需要同步移除当前项目 sidebar 中的会话。
  // 注意：session-store.sessions 只保存当前项目，切换项目时会发生整体替换，因此只应移除当前项目缓存中的会话。
  useSessionStore.subscribe((state, prevState) => {
    if (state.sessions === prevState.sessions) return
    const currentWorkspaceId = get().currentWorkspace?.id
    if (!currentWorkspaceId) return
    const currentIds = new Set(state.sessions.map(s => s.id))
    const removedIds = prevState.sessions.filter(s => !currentIds.has(s.id)).map(s => s.id)
    if (removedIds.length === 0) return
    set(wsState => {
      const sessions = wsState.workspaceSessions[currentWorkspaceId] ?? []
      const filtered = sessions.filter(s => !removedIds.includes(s.id))
      if (filtered.length === sessions.length) return wsState
      return {
        workspaceSessions: {
          ...wsState.workspaceSessions,
          [currentWorkspaceId]: filtered,
        },
      }
    })
  })

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
      useSessionStore.getState().resetForWorkspace()
      useWindowStore.getState().setWorkspaceId(id)

      // 直接从全量缓存初始化当前项目的会话，避免切换时请求 API 并导致 sidebar 闪烁
      const cachedSessions = get().workspaceSessions[id] ?? []
      useSessionStore.getState().setSessions(cachedSessions)

      const params = new URLSearchParams(window.location.search)
      params.set('workspaceId', id)
      history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)

      if (window.electron?.workspace?.setActiveWorkspaceId) {
        void window.electron.workspace.setActiveWorkspaceId(id)
      }

      try {
        await apiClient.post(`/workspaces/${id}/activate`, undefined, { toast: '切换项目失败' })
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
        set(state => ({
          workspaces: remaining,
          workspaceSessions: Object.fromEntries(
            Object.entries(state.workspaceSessions).filter(([wsId]) => wsId !== id)
          ),
        }))
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
          const updated = sessions.map(s => {
            if (s.id !== sessionId) return s
            changed = true
            return { ...s, ...patch }
          })
          next[wsId] = updated
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
          }
          next[wsId] = filtered
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
