import { create } from 'zustand'
import { toastError } from '@/lib/toast'
import type { AgentSession, AgentType, CanvasEdge, GitLogResponse, KanbanColumn, SessionStatus } from '@akari/shared-types'
import { API_BASE, parseOkResponse } from '@/lib/api'

const KANBAN_STATUS: Partial<Record<KanbanColumn, SessionStatus>> = {
  'in-progress': 'running',
  'waiting-review': 'review',
  'done': 'completed',
}

interface SessionStore {
  sessions: AgentSession[]
  canvasEdges: CanvasEdge[]
  gitLogs: Record<string, GitLogResponse>
  activeSessionId: string | null
  globalViewMode: 'canvas' | 'kanban' | null
  pendingOps: Set<string>
  pendingCreatePosition: { x: number; y: number } | null
  selectedGitCommits: Record<string, string | null>

  addSession: (name: string, task: string, baseBranch?: string, agentType?: AgentType, canvasPosition?: { x: number; y: number }) => void
  moveToColumn: (id: string, column: KanbanColumn) => void
  updateCanvasPosition: (id: string, pos: { x: number; y: number }) => void
  selectSession: (id: string) => void
  openTab: (id: string) => void
  setGlobalViewMode: (mode: 'canvas' | 'kanban' | null) => void
  archiveSession: (id: string) => void
  deleteSession: (id: string) => void
  restoreSession: (id: string) => void
  setGitLog: (sessionId: string, log: GitLogResponse) => void
  setSelectedGitCommit: (sessionId: string, hash: string | null) => void
  fetchCanvasEdges: () => void
  setPendingCreatePosition: (position: { x: number; y: number } | null) => void
  resetForWorkspace: () => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  canvasEdges: [],
  gitLogs: {},
  activeSessionId: null,
  globalViewMode: null,
  pendingOps: new Set(),
  pendingCreatePosition: null,
  selectedGitCommits: {},

  addSession: (name, task, baseBranch = 'main', agentType = 'claude', canvasPosition) => {
    const pendingPos = get().pendingCreatePosition
    const body = JSON.stringify({ name: name.trim(), task: task.trim(), baseBranch, agentType, canvasPosition: canvasPosition ?? pendingPos })
    fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then(parseOkResponse)
      .then(r => r.json() as Promise<AgentSession>)
      .then((session: AgentSession) => {
        set(state => ({
          sessions: [...state.sessions.filter(s => s.id !== session.id), session],
          pendingCreatePosition: null,
        }))
        get().selectSession(session.id)
      })
      .catch(err => { toastError(`创建会话失败: ${err instanceof Error ? err.message : String(err)}`); console.error('[addSession] failed:', err) })
  },

  moveToColumn: (id, column) => {
    const prevColumn = (get().sessions.find(s => s.id === id))?.kanbanColumn
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, kanbanColumn: column } : s
      ),
    }))
    const targetStatus = KANBAN_STATUS[column]
    if (targetStatus) {
      fetch(`${API_BASE}/sessions/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      })
        .then(parseOkResponse)
        .catch(err => {
          console.error('[moveToColumn] status update failed:', err)
          toastError(`无法移动卡片: ${err instanceof Error ? err.message : String(err)}`)
          if (prevColumn !== undefined) {
            set(state => ({
              sessions: state.sessions.map(s =>
                s.id === id ? { ...s, kanbanColumn: prevColumn } : s
              ),
            }))
          }
        })
    }
  },

  updateCanvasPosition: (id, pos) => {
    const prevPos = get().sessions.find(s => s.id === id)?.canvasPosition
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, canvasPosition: pos } : s
      ),
    }))
    fetch(`${API_BASE}/sessions/${id}/canvas`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pos),
    })
      .then(parseOkResponse)
      .catch(err => {
        console.error('[updateCanvasPosition] failed:', err)
        toastError(`更新画布位置失败: ${err instanceof Error ? err.message : String(err)}`)
        if (prevPos !== undefined) {
          set(state => ({
            sessions: state.sessions.map(s =>
              s.id === id ? { ...s, canvasPosition: prevPos } : s
            ),
          }))
        }
      })
  },

  selectSession: (id) => {
    set({ activeSessionId: id, globalViewMode: null })
  },

  openTab: (id) => {
    get().selectSession(id)
  },

  setGlobalViewMode: (mode) => set({ globalViewMode: mode, activeSessionId: null }),

  archiveSession: (id) => {
    if (get().pendingOps.has(id)) return
    set(state => ({ pendingOps: new Set(state.pendingOps).add(id) }))
    fetch(`${API_BASE}/sessions/${id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(parseOkResponse)
      .then(() => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, status: 'archived' as SessionStatus, kanbanColumn: 'done' } : s
          ),
        }))
      })
      .catch(err => {
        console.error('[archiveSession] failed:', err)
        toastError(`归档失败: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        set(state => {
          const next = new Set(state.pendingOps)
          next.delete(id)
          return { pendingOps: next }
        })
      })
  },

  deleteSession: (id) => {
    if (get().pendingOps.has(id)) return
    set(state => ({ pendingOps: new Set(state.pendingOps).add(id) }))
    fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' })
      .then(parseOkResponse)
      .then(() => {
        set(state => ({
          sessions: state.sessions.filter(s => s.id !== id),
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        }))
      })
      .catch(err => {
        console.error('[deleteSession] failed:', err)
        toastError(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        set(state => {
          const next = new Set(state.pendingOps)
          next.delete(id)
          return { pendingOps: next }
        })
      })
  },

  restoreSession: (id) => {
    if (get().pendingOps.has(id)) return
    set(state => ({ pendingOps: new Set(state.pendingOps).add(id) }))
    fetch(`${API_BASE}/sessions/${id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(parseOkResponse)
      .then(() => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, status: 'paused' as SessionStatus, kanbanColumn: 'in-progress' } : s
          ),
        }))
      })
      .catch(err => {
        console.error('[restoreSession] failed:', err)
        toastError(`恢复失败: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        set(state => {
          const next = new Set(state.pendingOps)
          next.delete(id)
          return { pendingOps: next }
        })
      })
  },

  setGitLog: (sessionId, log) =>
    set(state => ({ gitLogs: { ...state.gitLogs, [sessionId]: log } })),

  setSelectedGitCommit: (sessionId, hash) =>
    set(state => ({ selectedGitCommits: { ...state.selectedGitCommits, [sessionId]: hash } })),

  fetchCanvasEdges: () => {
    fetch(`${API_BASE}/canvas/edges`)
      .then(parseOkResponse)
      .then(r => r.json() as Promise<CanvasEdge[]>)
      .then((edges: CanvasEdge[]) => set({ canvasEdges: edges }))
      .catch(err => console.error('[fetchCanvasEdges] failed:', err))
  },

  setPendingCreatePosition: (position) => set({ pendingCreatePosition: position }),

  resetForWorkspace: () => {
    set({
      sessions: [],
      activeSessionId: null,
      globalViewMode: null,
      gitLogs: {},
      selectedGitCommits: {},
      canvasEdges: [],
      pendingOps: new Set(),
      pendingCreatePosition: null,
    })
  },
}))
