import { create } from 'zustand'
import type { AgentSession, KanbanColumn, SessionStatus, ServerMessage } from '@akari/shared-types'
import type { ConnectionStatus } from '@/hooks/useWebSocket'


interface SessionStore {
  sessions: AgentSession[]
  viewMode: 'canvas' | 'kanban'
  openTabs: string[]
  activeTabId: string | null
  commandCenterOpen: boolean
  createDialogOpen: boolean
  connectionStatus: ConnectionStatus
  disconnectedAt: number | null

  addSession: (name: string, task: string, baseBranch?: string, agentType?: 'claude' | 'aider' | 'shell') => void
  updateStatus: (id: string, status: SessionStatus) => void
  moveToColumn: (id: string, column: KanbanColumn) => void
  updateCanvasPosition: (id: string, pos: { x: number; y: number }) => void
  openTab: (id: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  setViewMode: (mode: 'canvas' | 'kanban') => void
  toggleCommandCenter: () => void
  toggleCreateDialog: () => void
  approveSession: (id: string) => void
  rejectSession: (id: string) => void
  archiveSession: (id: string) => void
  deleteSession: (id: string) => void
  addTerminalLine: (id: string, line: string) => void
  clearTerminal: (id: string) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  handleServerMessage: (msg: ServerMessage) => void
}


const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  viewMode: 'canvas',
  openTabs: [],
  activeTabId: null,
  commandCenterOpen: false,
  createDialogOpen: false,
  connectionStatus: 'connecting',
  disconnectedAt: null,

  addSession: (name, task, baseBranch = 'main', agentType = 'claude') => {
    const body = JSON.stringify({ name: name.trim(), task: task.trim(), baseBranch, agentType })
    fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then(r => r.json())
      .then((session: AgentSession) => {
        set(state => ({
          sessions: [...state.sessions.filter(s => s.id !== session.id), session],
        }))
        get().openTab(session.id)
      })
      .catch(err => console.error('[addSession] failed:', err))
    get().toggleCreateDialog()
  },

  updateStatus: (id, status) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, status } : s
      ),
    })),

  moveToColumn: (id, column) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, kanbanColumn: column } : s
      ),
    }))
    const KANBAN_STATUS: Partial<Record<KanbanColumn, SessionStatus>> = {
      'in-progress': 'running',
      'waiting-review': 'review',
      'done': 'completed',
    }
    const targetStatus = KANBAN_STATUS[column]
    if (targetStatus) {
      fetch(`${API_BASE}/sessions/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      }).catch(err => console.warn('[moveToColumn] status update failed:', err))
    }
  },

  updateCanvasPosition: (id, pos) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, canvasPosition: pos } : s
      ),
    }))
    fetch(`${API_BASE}/sessions/${id}/canvas`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pos),
    }).catch(err => console.warn('[updateCanvasPosition]', err))
  },

  openTab: (id) =>
    set(state => {
      const tabs = state.openTabs.includes(id) ? state.openTabs : [...state.openTabs, id]
      return { openTabs: tabs, activeTabId: id }
    }),

  closeTab: (id) =>
    set(state => {
      const tabs = state.openTabs.filter(t => t !== id)
      const newActive = state.activeTabId === id
        ? (tabs.length > 0 ? tabs[tabs.length - 1] : null)
        : state.activeTabId
      return { openTabs: tabs, activeTabId: newActive }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleCommandCenter: () =>
    set(state => ({ commandCenterOpen: !state.commandCenterOpen })),

  toggleCreateDialog: () =>
    set(state => ({ createDialogOpen: !state.createDialogOpen })),

  approveSession: (id) => {
    fetch(`${API_BASE}/sessions/${id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    }).catch(err => console.error('[approveSession] failed:', err))
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id
          ? { ...s, status: 'running' as SessionStatus, terminalOutput: [...s.terminalOutput, '> ✅ Approved, resuming...'] }
          : s
      ),
    }))
  },

  rejectSession: (id) => {
    fetch(`${API_BASE}/sessions/${id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    }).catch(err => console.error('[rejectSession] failed:', err))
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id
          ? { ...s, status: 'paused' as SessionStatus, terminalOutput: [...s.terminalOutput, '> ❌ Rejected, paused'] }
          : s
      ),
    }))
  },

  archiveSession: (id) => {
    fetch(`${API_BASE}/sessions/${id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(() => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, status: 'archived' as SessionStatus, kanbanColumn: 'done' } : s
          ),
        }))
      })
      .catch(err => console.error('[archiveSession] failed:', err))
  },

  deleteSession: (id) => {
    fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' })
      .then(() => {
        set(state => ({
          sessions: state.sessions.filter(s => s.id !== id),
          openTabs: state.openTabs.filter(t => t !== id),
          activeTabId: state.activeTabId === id ? null : state.activeTabId,
        }))
      })
      .catch(err => console.error('[deleteSession] failed:', err))
  },

  addTerminalLine: (id, line) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, terminalOutput: [...s.terminalOutput, line] } : s
      ),
    })),

  clearTerminal: (id) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, terminalOutput: [] } : s
      ),
    })),

  setConnectionStatus: (status) =>
    set(state => ({
      connectionStatus: status,
      disconnectedAt:
        status === 'disconnected' && state.connectionStatus === 'connected'
          ? Date.now()
          : status === 'connected'
            ? null
            : state.disconnectedAt,
    })),

  handleServerMessage: (msg) => {
    switch (msg.event) {
      case 'sessions:list':
        set({ sessions: msg.payload })
        break
      case 'session:created':
        set(state => ({
          sessions: [...state.sessions.filter(s => s.id !== msg.payload.id), msg.payload],
        }))
        get().openTab(msg.payload.id)
        break
      case 'session:updated':
        set(state => ({
          sessions: state.sessions.map(s => s.id === msg.payload.id ? msg.payload : s),
        }))
        break
      case 'session:status':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.id
              ? { ...s, status: msg.payload.status, progress: msg.payload.progress }
              : s
          ),
        }))
        break
      case 'terminal:data':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? { ...s, terminalOutput: [...s.terminalOutput, msg.payload.data].slice(-500) }
              : s
          ),
        }))
        break
      case 'approval:required':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? { ...s, status: 'waiting', pendingApproval: msg.payload.request }
              : s
          ),
        }))
        break
      case 'checkpoint:reached':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? { ...s, terminalOutput: [...s.terminalOutput, `[CHECKPOINT] ${msg.payload.description}`].slice(-500) }
              : s
          ),
        }))
        break
      case 'diff:update':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? {
                  ...s,
                  diffSummary: msg.payload.diff.stat,
                  diffFull: msg.payload.diff.fullDiff,
                  diffFiles: msg.payload.diff.files,
                }
              : s
          ),
        }))
        break
    }
  },
}))
