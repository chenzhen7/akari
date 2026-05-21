import { create } from 'zustand'
import type { AgentSession, KanbanColumn, SessionStatus, ServerMessage } from '@akari/shared-types'
import type { ConnectionStatus } from '@/hooks/useWebSocket'

const mockSessions: AgentSession[] = [
  {
    id: 'sess-1',
    name: 'feat/user-auth',
    task: '实现用户认证模块：JWT token 管理、OAuth 集成、权限中间件',
    status: 'running',
    agentType: 'claude',
    worktreePath: '.agent-worktrees/sess-1',
    branchName: 'agent/feat-user-auth-sess1',
    baseBranch: 'main',
    progress: 67,
    kanbanColumn: 'in-progress',
    canvasPosition: { x: 100, y: 100 },
    canvasSize: { width: 280, height: 220 },
    terminalId: 'term-1',
    terminalOutput: [
      '$ claude --continue',
      '> Reading src/auth/login.ts...',
      '> Implementing JWT validation middleware',
      '> Writing tests for auth module...',
      '> ✓ Created src/auth/jwt.ts',
      '> Running tests...',
      '> ████████░░ 4/5 tests passing',
    ],
    diffSummary: `src/auth/login.ts       +45  -3
src/auth/jwt.ts         +89  -0
src/middleware/auth.ts  +34 -12`,
    createdAt: new Date(Date.now() - 3600000 * 2),
    tags: ['auth', 'backend'],
  },
  {
    id: 'sess-2',
    name: 'feat/payment',
    task: '实现支付模块：Stripe 集成、订单状态机、退款处理',
    status: 'waiting',
    agentType: 'claude',
    worktreePath: '.agent-worktrees/sess-2',
    branchName: 'agent/feat-payment-sess2',
    baseBranch: 'main',
    progress: 100,
    kanbanColumn: 'waiting-review',
    canvasPosition: { x: 500, y: 80 },
    canvasSize: { width: 280, height: 220 },
    terminalId: 'term-2',
    terminalOutput: [
      '$ claude --continue',
      '> Payment module completed',
      '> [APPROVAL_REQUIRED] type=destructive command="rm -rf dist"',
      '> Waiting for user approval...',
    ],
    diffSummary: `src/payment/stripe.ts   +234 -12
src/payment/order.ts    +156  -8
src/payment/refund.ts   +89  -0`,
    createdAt: new Date(Date.now() - 3600000 * 4),
    tags: ['payment', 'backend'],
  },
  {
    id: 'sess-3',
    name: 'feat/dashboard',
    task: '实现管理后台仪表盘：数据可视化、实时图表、权限控制',
    status: 'failed',
    agentType: 'claude',
    worktreePath: '.agent-worktrees/sess-3',
    branchName: 'agent/feat-dashboard-sess3',
    baseBranch: 'main',
    progress: 30,
    kanbanColumn: 'in-progress',
    canvasPosition: { x: 150, y: 400 },
    canvasSize: { width: 280, height: 220 },
    terminalId: 'term-3',
    terminalOutput: [
      '$ claude --continue',
      '> Setting up dashboard layout...',
      '> Error: Connection timeout after 30000ms',
      '> Task failed',
    ],
    diffSummary: `src/dashboard/layout.ts  +12  -3
src/dashboard/chart.ts   +0   -0`,
    createdAt: new Date(Date.now() - 3600000 * 1),
    tags: ['dashboard', 'frontend'],
  },
  {
    id: 'sess-4',
    name: 'feat/api-refactor',
    task: '重构 API 层：统一错误处理、提取公共中间件、OpenAPI 文档生成',
    status: 'initializing',
    agentType: 'claude',
    worktreePath: '.agent-worktrees/sess-4',
    branchName: 'agent/feat-api-refactor-sess4',
    baseBranch: 'main',
    progress: 0,
    kanbanColumn: 'backlog',
    canvasPosition: { x: 550, y: 450 },
    canvasSize: { width: 280, height: 220 },
    terminalId: 'term-4',
    terminalOutput: [
      '> Creating worktree...',
      '> Setting up branch agent/feat-api-refactor-sess4',
    ],
    diffSummary: '',
    createdAt: new Date(),
    tags: ['api', 'refactor'],
  },
  {
    id: 'sess-5',
    name: 'feat/logging',
    task: '实现结构化日志系统：Pino 集成、日志轮转、ELK 导出',
    status: 'completed',
    agentType: 'claude',
    worktreePath: '.agent-worktrees/sess-5',
    branchName: 'agent/feat-logging-sess5',
    baseBranch: 'main',
    progress: 100,
    kanbanColumn: 'done',
    canvasPosition: { x: 900, y: 200 },
    canvasSize: { width: 280, height: 220 },
    terminalId: 'term-5',
    terminalOutput: [
      '$ claude --continue',
      '> Implementing Pino logger...',
      '> All tests passed',
      '> ✅ Task completed successfully',
    ],
    diffSummary: `src/logger/pino.ts      +120  -0
src/logger/rotate.ts    +45   -0
src/logger/elk.ts       +67   -0`,
    createdAt: new Date(Date.now() - 3600000 * 8),
    tags: ['logging', 'infrastructure'],
  },
]

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
  addTerminalLine: (id: string, line: string) => void
  clearTerminal: (id: string) => void
  setConnectionStatus: (status: ConnectionStatus) => void
  handleServerMessage: (msg: ServerMessage) => void
}


const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: mockSessions,
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

  moveToColumn: (id, column) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, kanbanColumn: column } : s
      ),
    })),

  updateCanvasPosition: (id, pos) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, canvasPosition: pos } : s
      ),
    })),

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
              ? { ...s, diffSummary: msg.payload.diff.stat }
              : s
          ),
        }))
        break
    }
  },
}))
