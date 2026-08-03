import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { apiClient } from '@/shared/lib/api-client'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import type { AgentSession, AgentType, CanvasEdge, GitLogResponse, KanbanColumn, SessionStatus } from '@akari/shared-types'

const KANBAN_STATUS: Partial<Record<KanbanColumn, SessionStatus>> = {
  'in-progress': 'running',
  'waiting-review': 'review',
  'done': 'completed',
}

const EMPTY_SESSIONS: AgentSession[] = []

/**
 * 会话领域动作 + 每会话的零散 UI 态。
 *
 * 会话数据本身不再存在本 store 中——唯一数据源是 workspace-store.workspaceSessions。
 * 所有 CRUD 动作只写缓存；「选中/视图」状态只写 navigation-store。数据更新绝不改动选中。
 */
interface SessionStore {
  canvasEdges: CanvasEdge[]
  gitLogs: Record<string, GitLogResponse>
  pendingOps: Set<string>
  pendingCreatePosition: { x: number; y: number } | null
  selectedGitCommits: Record<string, string | null>

  addSession: (name: string, task: string, baseBranch?: string, agentType?: AgentType, canvasPosition?: { x: number; y: number }) => void
  moveToColumn: (id: string, column: KanbanColumn) => void
  updateCanvasPosition: (id: string, pos: { x: number; y: number }) => void
  archiveSession: (id: string) => void
  deleteSession: (id: string) => void
  restoreSession: (id: string) => void
  setGitLog: (sessionId: string, log: GitLogResponse) => void
  setSelectedGitCommit: (sessionId: string, hash: string | null) => void
  fetchCanvasEdges: () => void
  setPendingCreatePosition: (position: { x: number; y: number } | null) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  canvasEdges: [],
  gitLogs: {},
  pendingOps: new Set(),
  pendingCreatePosition: null,
  selectedGitCommits: {},

  addSession: (name, task, baseBranch = 'main', agentType = 'claude', canvasPosition) => {
    const pendingPos = get().pendingCreatePosition
    const body = { name: name.trim(), task: task.trim(), baseBranch, agentType, canvasPosition: canvasPosition ?? pendingPos }
    apiClient.post<AgentSession>('/sessions', body, { toast: '创建会话失败' })
      .then((session) => {
        useWorkspaceStore.getState().addSession(session)
        useNavigationStore.getState().selectSession(session.id)
        set({ pendingCreatePosition: null })
      })
      .catch(err => { console.error('[addSession] failed:', err) })
  },

  moveToColumn: (id, column) => {
    const ws = useWorkspaceStore.getState()
    const wsId = ws.currentWorkspace?.id
    const prevColumn = wsId
      ? (ws.workspaceSessions[wsId] ?? EMPTY_SESSIONS).find(s => s.id === id)?.kanbanColumn
      : undefined
    ws.updateSession(id, { kanbanColumn: column })
    const targetStatus = KANBAN_STATUS[column]
    if (targetStatus) {
      apiClient.patch(`/sessions/${id}/status`, { status: targetStatus }, { toast: '无法移动卡片' })
        .catch(err => {
          console.error('[moveToColumn] status update failed:', err)
          if (prevColumn !== undefined) {
            ws.updateSession(id, { kanbanColumn: prevColumn })
          }
        })
    }
  },

  updateCanvasPosition: (id, pos) => {
    const ws = useWorkspaceStore.getState()
    const wsId = ws.currentWorkspace?.id
    const prevPos = wsId
      ? (ws.workspaceSessions[wsId] ?? EMPTY_SESSIONS).find(s => s.id === id)?.canvasPosition
      : undefined
    ws.updateSession(id, { canvasPosition: pos })
    apiClient.patch(`/sessions/${id}/canvas`, pos, { toast: '更新画布位置失败' })
      .catch(err => {
        console.error('[updateCanvasPosition] failed:', err)
        if (prevPos !== undefined) {
          ws.updateSession(id, { canvasPosition: prevPos })
        }
      })
  },

  archiveSession: (id) => {
    if (get().pendingOps.has(id)) return
    set(state => ({ pendingOps: new Set(state.pendingOps).add(id) }))
    apiClient.post(`/sessions/${id}/archive`, {}, { toast: '归档失败' })
      .then(() => {
        useWorkspaceStore.getState().updateSession(id, { status: 'archived' as SessionStatus, kanbanColumn: 'done' })
      })
      .catch(err => {
        console.error('[archiveSession] failed:', err)
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
    apiClient.delete(`/sessions/${id}`, { toast: '删除失败' })
      .then(() => {
        const ws = useWorkspaceStore.getState()
        ws.removeSession(id)
        // 删除的若是当前选中会话，则重选第一个（数据删除只修正选中，不改动视图模式）
        if (useNavigationStore.getState().sessionId === id) {
          const wsId = ws.currentWorkspace?.id
          const ids = wsId ? (ws.workspaceSessions[wsId] ?? []).map(s => s.id) : []
          useNavigationStore.getState().reconcile(ids)
        }
      })
      .catch(err => {
        console.error('[deleteSession] failed:', err)
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
    apiClient.post(`/sessions/${id}/restore`, {}, { toast: '恢复失败' })
      .then(() => {
        useWorkspaceStore.getState().updateSession(id, { status: 'paused' as SessionStatus, kanbanColumn: 'in-progress' })
      })
      .catch(err => {
        console.error('[restoreSession] failed:', err)
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
    apiClient.get<CanvasEdge[]>('/canvas/edges', { toast: false })
      .then((edges) => set({ canvasEdges: edges }))
      .catch(err => console.error('[fetchCanvasEdges] failed:', err))
  },

  setPendingCreatePosition: (position) => set({ pendingCreatePosition: position }),
}))

// ─── 派生选择器：从唯一数据源 workspaceSessions 读取会话 ─────────────────────────

/** 在全部工作区缓存中查找会话（跨工作区兜底，保证任意上下文都能取到） */
export function findSession(all: Record<string, AgentSession[]>, sessionId: string): AgentSession | undefined {
  for (const list of Object.values(all)) {
    const found = list.find(s => s.id === sessionId)
    if (found) return found
  }
  return undefined
}

/** 当前工作区的会话列表（与侧边栏共享同一数据源） */
export function useCurrentSessions(): AgentSession[] {
  return useWorkspaceStore(useShallow(s => {
    const wsId = s.currentWorkspace?.id
    return wsId ? (s.workspaceSessions[wsId] ?? EMPTY_SESSIONS) : EMPTY_SESSIONS
  }))
}

/** 按 id 取会话；会话对象引用稳定，仅在其自身变化时触发重渲染 */
export function useSessionById(sessionId: string | null | undefined): AgentSession | undefined {
  return useWorkspaceStore(useShallow(s => {
    if (!sessionId) return undefined
    return findSession(s.workspaceSessions, sessionId)
  }))
}
