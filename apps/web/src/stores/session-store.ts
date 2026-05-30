import { create } from 'zustand'
import { toast } from 'sonner'
import type { AgentSession, AgentType, CanvasEdge, GitLogResponse, KanbanColumn, SessionStatus, ServerMessage } from '@akari/shared-types'
import type { ConnectionStatus } from '@/hooks/useWebSocket'
import { terminalBus } from '@/lib/terminalBus'


interface SessionStore {
  sessions: AgentSession[]
  canvasEdges: CanvasEdge[]
  gitLogs: Record<string, GitLogResponse>
  viewMode: 'canvas' | 'kanban'
  sidebarOpen: boolean
  openTabs: string[]
  activeTabId: string | null
  commandCenterOpen: boolean
  createDialogOpen: boolean
  connectionStatus: ConnectionStatus
  disconnectedAt: number | null
  terminalReadyTick: Record<string, number>
  /** Tracks ops that are in-flight (archive / delete / restore) for debounce animation */
  pendingOps: Set<string>
  /** 存储右键新建会话时的画布位置 */
  pendingCreatePosition: { x: number; y: number } | null

  addSession: (name: string, task: string, baseBranch?: string, agentType?: AgentType, canvasPosition?: { x: number; y: number }) => void
  openCreateDialog: (position?: { x: number; y: number }) => void
  fetchCanvasEdges: () => void
  updateStatus: (id: string, status: SessionStatus) => void
  moveToColumn: (id: string, column: KanbanColumn) => void
  updateCanvasPosition: (id: string, pos: { x: number; y: number }) => void
  openTab: (id: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  setViewMode: (mode: 'canvas' | 'kanban') => void
  toggleSidebar: () => void
  toggleCommandCenter: () => void
  toggleCreateDialog: () => void
  approveSession: (id: string, approvalOption?: string) => void
  rejectSession: (id: string) => void
  ignoreApproval: (id: string) => void
  archiveSession: (id: string) => void
  deleteSession: (id: string) => void
  restoreSession: (id: string) => void
  addTerminalLine: (id: string, line: string) => void
  clearTerminal: (id: string) => void
  setGitLog: (sessionId: string, log: GitLogResponse) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  handleServerMessage: (msg: ServerMessage) => void
}


const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  canvasEdges: [],
  gitLogs: {},
  viewMode: 'canvas',
  sidebarOpen: false,
  openTabs: [],
  activeTabId: null,
  commandCenterOpen: false,
  createDialogOpen: false,
  connectionStatus: 'connecting',
  disconnectedAt: null,
  terminalReadyTick: {},
  pendingOps: new Set(),
  pendingCreatePosition: null,

  openCreateDialog: (position) => {
    set({ createDialogOpen: true, pendingCreatePosition: position ?? null })
  },

  fetchCanvasEdges: () => {
    fetch(`${API_BASE}/canvas/edges`)
      .then(r => r.json())
      .then((edges: CanvasEdge[]) => set({ canvasEdges: edges }))
      .catch(err => console.warn('[fetchCanvasEdges] failed:', err))
  },

  addSession: (name, task, baseBranch = 'main', agentType = 'claude', canvasPosition) => {
    const pendingPos = get().pendingCreatePosition
    const body = JSON.stringify({ name: name.trim(), task: task.trim(), baseBranch, agentType, canvasPosition: canvasPosition ?? pendingPos })
    fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then(r => r.json())
      .then((session: AgentSession) => {
        set(state => ({
          sessions: [...state.sessions.filter(s => s.id !== session.id), session],
          pendingCreatePosition: null,
        }))
      })
      .catch(err => { toast.error(`创建会话失败: ${err}`); console.error('[addSession] failed:', err) })
    get().toggleCreateDialog()
  },

  updateStatus: (id, status) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, status } : s
      ),
    })),

  moveToColumn: (id, column) => {
    const prevColumn = (get().sessions.find(s => s.id === id))?.kanbanColumn
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
      })
        .then(res => {
          if (!res.ok) return res.json().then(body => Promise.reject(body?.message ?? res.statusText))
        })
        .catch(err => {
          console.warn('[moveToColumn] status update failed:', err)
          toast.error(`无法移动卡片: ${err}`)
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

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),

  toggleCommandCenter: () =>
    set(state => ({ commandCenterOpen: !state.commandCenterOpen })),

  toggleCreateDialog: () =>
    set(state => ({ createDialogOpen: !state.createDialogOpen })),

  approveSession: (id: string, approvalOption?: string) => {
    fetch(`${API_BASE}/sessions/${id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', approvalOption }),
    }).catch(err => console.error('[approveSession] failed:', err))
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, status: 'running' as SessionStatus } : s
      ),
    }))
  },

  rejectSession: (id: string) => {
    fetch(`${API_BASE}/sessions/${id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    }).catch(err => console.error('[rejectSession] failed:', err))
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, status: 'paused' as SessionStatus } : s
      ),
    }))
  },

  ignoreApproval: (id: string) => {
    fetch(`${API_BASE}/sessions/${id}/approval-ignore`, { method: 'POST' })
      .catch(err => console.error('[ignoreApproval] failed:', err))
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, pendingApproval: undefined } : s
      ),
    }))
  },

  archiveSession: (id) => {
    if (get().pendingOps.has(id)) return
    set(state => ({ pendingOps: new Set(state.pendingOps).add(id) }))
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
      .then(() => {
        set(state => ({
          sessions: state.sessions.filter(s => s.id !== id),
          openTabs: state.openTabs.filter(t => t !== id),
          activeTabId: state.activeTabId === id ? null : state.activeTabId,
        }))
      })
      .catch(err => console.error('[deleteSession] failed:', err))
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
      .then(() => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, status: 'paused' as SessionStatus, kanbanColumn: 'in-progress' } : s
          ),
        }))
      })
      .catch(err => console.error('[restoreSession] failed:', err))
      .finally(() => {
        set(state => {
          const next = new Set(state.pendingOps)
          next.delete(id)
          return { pendingOps: next }
        })
      })
  },

  addTerminalLine: (id, line) => {
    terminalBus.emit(id, line)
  },

  clearTerminal: (id) => {
    terminalBus.clear(id)
  },

  setGitLog: (sessionId, log) =>
    set(state => ({ gitLogs: { ...state.gitLogs, [sessionId]: log } })),

  setConnectionStatus: (status) => {
    set(state => ({
      connectionStatus: status,
      disconnectedAt:
        status === 'disconnected' && state.connectionStatus === 'connected'
          ? Date.now()
          : status === 'connected'
            ? null
            : state.disconnectedAt,
    }))
    if (status === 'connected') {
      get().fetchCanvasEdges()
    }
  },

  handleServerMessage: (msg) => {
    switch (msg.event) {
      case 'sessions:list':
        set({ sessions: msg.payload })
        break
      case 'session:created':
        set(state => ({
          sessions: [...state.sessions.filter(s => s.id !== msg.payload.id), msg.payload],
        }))
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
        terminalBus.emit(msg.payload.sessionId, msg.payload.data)
        break
      case 'terminal:ready':
        set(state => ({
          terminalReadyTick: {
            ...state.terminalReadyTick,
            [msg.payload.sessionId]: (state.terminalReadyTick[msg.payload.sessionId] ?? 0) + 1,
          },
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
      case 'git:log-updated': {
        const { sessionId, commits, branches, head } = msg.payload
        set(state => ({
          gitLogs: { ...state.gitLogs, [sessionId]: { commits, branches, head } },
        }))
        break
      }
      case 'canvas:edges':
        set({ canvasEdges: msg.payload })
        break
      case 'session:lastMessage':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.id ? { ...s, lastAiMessage: msg.payload.lastAiMessage } : s
          ),
        }))
        break
    }
  },
}))
