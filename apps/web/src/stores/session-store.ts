import { create } from 'zustand'
import { toast } from 'sonner'
import type { AgentSession, AgentType, CanvasEdge, GitLogResponse, KanbanColumn, SessionStatus, ServerMessage } from '@akari/shared-types'
import type { ConnectionStatus } from '@/hooks/useWebSocket'
import { terminalBus } from '@/lib/terminalBus'
import { useWorkspaceStore } from './workspace-store'

interface SessionStore {
  sessions: AgentSession[]
  canvasEdges: CanvasEdge[]
  gitLogs: Record<string, GitLogResponse>
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
  /** 右侧面板当前 Tab（git-graph | diff | info | explorer） */
  activeRightTab: 'git-graph' | 'diff' | 'info' | 'explorer'
  /** 全局视图模式：null 表示显示会话标签，canvas/kanban 表示显示全局视图 */
  globalViewMode: 'canvas' | 'kanban' | null
  /** 当前选中的会话 ID（侧边栏高亮 + 中间区域显示该会话的标签栏） */
  activeSessionId: string | null

  addSession: (name: string, task: string, baseBranch?: string, agentType?: AgentType, canvasPosition?: { x: number; y: number }) => void
  openCreateDialog: (position?: { x: number; y: number }) => void
  fetchCanvasEdges: () => void
  updateStatus: (id: string, status: SessionStatus) => void
  moveToColumn: (id: string, column: KanbanColumn) => void
  updateCanvasPosition: (id: string, pos: { x: number; y: number }) => void
  openTab: (id: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string | null) => void
  selectSession: (id: string) => void
  setGlobalViewMode: (mode: 'canvas' | 'kanban' | null) => void
  toggleCommandCenter: () => void
  toggleCreateDialog: () => void
  archiveSession: (id: string) => void
  deleteSession: (id: string) => void
  restoreSession: (id: string) => void
  addTerminalLine: (id: string, line: string) => void
  clearTerminal: (id: string) => void
  setGitLog: (sessionId: string, log: GitLogResponse) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setActiveRightTab: (tab: 'git-graph' | 'diff' | 'info' | 'explorer') => void
  createTab: (sessionId: string, type: 'terminal' | 'claude' | 'diff' | 'file', filePath?: string) => void
  closeTab: (sessionId: string, tabId: string) => void
  activateTab: (sessionId: string, tabId: string) => void
  reorderTabs: (sessionId: string, orderedTabIds: string[]) => void
  createTerminal: (sessionId: string) => void
  handleServerMessage: (msg: ServerMessage) => void
}

export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/** 功能开关：临时关闭画布视图 */
export const CANVAS_ENABLED = false

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  canvasEdges: [],
  gitLogs: {},
  openTabs: [],
  activeTabId: null,
  commandCenterOpen: false,
  createDialogOpen: false,
  connectionStatus: 'connecting',
  disconnectedAt: null,
  terminalReadyTick: {},
  pendingOps: new Set(),
  pendingCreatePosition: null,
  activeRightTab: 'explorer',
  globalViewMode: null,
  activeSessionId: null,

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
        get().selectSession(session.id)
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

  selectSession: (id) => {
    set(state => {
      const tabs = state.openTabs.includes(id) ? state.openTabs : [...state.openTabs, id]
      return { activeSessionId: id, globalViewMode: null, openTabs: tabs, activeTabId: id }
    })
  },

  setGlobalViewMode: (mode) => set({ globalViewMode: mode, activeSessionId: null }),

  toggleCommandCenter: () =>
    set(state => ({ commandCenterOpen: !state.commandCenterOpen })),

  toggleCreateDialog: () =>
    set(state => ({ createDialogOpen: !state.createDialogOpen })),

  archiveSession: (id) => {
    if (get().pendingOps.has(id)) return
    set(state => ({ pendingOps: new Set(state.pendingOps).add(id) }))
    fetch(`${API_BASE}/sessions/${id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, status: 'archived' as SessionStatus, kanbanColumn: 'done' } : s
          ),
        }))
      })
      .catch(err => {
        console.error('[archiveSession] failed:', err)
        toast.error(`归档失败: ${err instanceof Error ? err.message : String(err)}`)
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
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${res.status}`)
        }
        set(state => ({
          sessions: state.sessions.filter(s => s.id !== id),
          openTabs: state.openTabs.filter(t => t !== id),
          activeTabId: state.activeTabId === id ? null : state.activeTabId,
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        }))
      })
      .catch(err => {
        console.error('[deleteSession] failed:', err)
        toast.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`)
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

  setActiveRightTab: (tab) => set({ activeRightTab: tab }),

  createTab: (sessionId, type, filePath) => {
    const ws = getWebSocket()
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'tab:create', payload: { sessionId, type, filePath } }))
    }
  },

  closeTab: (sessionId, tabId) => {
    const ws = getWebSocket()
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'tab:close', payload: { sessionId, tabId } }))
    }
  },

  activateTab: (sessionId, tabId) => {
    const ws = getWebSocket()
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'tab:activate', payload: { sessionId, tabId } }))
    }
  },

  reorderTabs: (sessionId, orderedTabIds) => {
    // Optimistically update local order so the UI doesn't flash on drag end.
    set(state => ({
      sessions: state.sessions.map(s => {
        if (s.id !== sessionId) return s
        const tabMap = new Map(s.tabs.map(t => [t.id, t]))
        const reordered = orderedTabIds.map(id => tabMap.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
        return { ...s, tabs: reordered }
      }),
    }))

    const ws = getWebSocket()
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'tab:reorder', payload: { sessionId, orderedTabIds } }))
    }
  },

  createTerminal: (sessionId) => {
    const ws = getWebSocket()
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'terminal:create', payload: { sessionId } }))
    }
  },

  handleServerMessage: (msg) => {
    switch (msg.event) {
      case 'sessions:list':
        set(state => {
          let nextActiveSessionId = state.activeSessionId
          // 如果当前没有选中会话或选中的已不存在，自动选中第一个
          if (!nextActiveSessionId || !msg.payload.some((s: AgentSession) => s.id === nextActiveSessionId)) {
            nextActiveSessionId = msg.payload.length > 0 ? msg.payload[0].id : null
          }
          return { sessions: msg.payload, activeSessionId: nextActiveSessionId }
        })
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
        terminalBus.emit(msg.payload.terminalId, msg.payload.data)
        break
      case 'terminal:ready':
        set(state => ({
          terminalReadyTick: {
            ...state.terminalReadyTick,
            [msg.payload.terminalId]: (state.terminalReadyTick[msg.payload.terminalId] ?? 0) + 1,
          },
        }))
        break
      case 'terminal:resized':
        terminalBus.resized(msg.payload.terminalId)
        break
      case 'diff:update':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? {
                ...s,
                diffSummary: msg.payload.diff.summary,
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
      case 'tab:created':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? { ...s, tabs: [...s.tabs, msg.payload.tab] }
              : s
          ),
        }))
        break
      case 'tab:closed':
        set(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== msg.payload.sessionId) return s
            const updatedTabs = s.tabs.filter(t => t.id !== msg.payload.tabId)
            let activeTabId = s.activeTabId
            if (activeTabId === msg.payload.tabId) {
              activeTabId = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null
            }
            return { ...s, tabs: updatedTabs, activeTabId }
          }),
        }))
        break
      case 'tab:activated':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? { ...s, activeTabId: msg.payload.tabId }
              : s
          ),
        }))
        break
      case 'tabs:sync':
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === msg.payload.sessionId
              ? { ...s, tabs: msg.payload.tabs, activeTabId: msg.payload.activeTabId }
              : s
          ),
        }))
        break
      case 'workspace:current':
        useWorkspaceStore.getState().setCurrentWorkspace(msg.payload)
        set({
          sessions: [],
          openTabs: [],
          activeTabId: null,
          activeSessionId: null,
          globalViewMode: null,
          gitLogs: {},
        })
        break
      case 'workspace:list':
        useWorkspaceStore.setState({ workspaces: msg.payload })
        break
    }
  },
}))

let _ws: WebSocket | null = null

export function setWebSocket(ws: WebSocket | null) {
  _ws = ws
}

function getWebSocket(): WebSocket | null {
  return _ws
}
