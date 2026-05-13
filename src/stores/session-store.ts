import { create } from 'zustand'
import type { AgentSession, KanbanColumn, SessionStatus } from '@/types'

const mockSessions: AgentSession[] = [
  {
    id: 'sess-1',
    name: 'feat/user-auth',
    task: '实现用户认证模块：JWT token 管理、OAuth 集成、权限中间件',
    status: 'running',
    branchName: 'agent/feat-user-auth-sess1',
    baseBranch: 'main',
    progress: 67,
    kanbanColumn: 'in-progress',
    canvasPosition: { x: 100, y: 100 },
    canvasSize: { width: 280, height: 220 },
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
    branchName: 'agent/feat-payment-sess2',
    baseBranch: 'main',
    progress: 100,
    kanbanColumn: 'waiting-review',
    canvasPosition: { x: 500, y: 80 },
    canvasSize: { width: 280, height: 220 },
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
    branchName: 'agent/feat-dashboard-sess3',
    baseBranch: 'main',
    progress: 30,
    kanbanColumn: 'in-progress',
    canvasPosition: { x: 150, y: 400 },
    canvasSize: { width: 280, height: 220 },
    terminalOutput: [
      '$ claude --continue',
      '> Setting up dashboard layout...',
      '> Error: Connection timeout after 30000ms',
      '> Retrying...',
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
    branchName: 'agent/feat-api-refactor-sess4',
    baseBranch: 'main',
    progress: 0,
    kanbanColumn: 'backlog',
    canvasPosition: { x: 550, y: 450 },
    canvasSize: { width: 280, height: 220 },
    terminalOutput: [
      '$ claude --continue',
      '> Creating worktree...',
      '> Setting up branch agent/feat-api-refactor-sess4',
      '> Installing dependencies...',
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
    branchName: 'agent/feat-logging-sess5',
    baseBranch: 'main',
    progress: 100,
    kanbanColumn: 'done',
    canvasPosition: { x: 900, y: 200 },
    canvasSize: { width: 280, height: 220 },
    terminalOutput: [
      '$ claude --continue',
      '> Implementing Pino logger...',
      '> Setting up log rotation...',
      '> All tests passed',
      '> ✅ Task completed successfully',
      '> Merged to main',
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

  addSession: (name: string, task: string, baseBranch?: string) => void
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
}

function generateId(): string {
  return 'sess-' + Math.random().toString(36).slice(2, 10)
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: mockSessions,
  viewMode: 'canvas',
  openTabs: [],
  activeTabId: null,
  commandCenterOpen: false,
  createDialogOpen: false,

  addSession: (name, task, baseBranch = 'main') => {
    const id = generateId()
    const newSession: AgentSession = {
      id,
      name,
      task,
      status: 'initializing',
      branchName: `agent/${name.replace(/\//g, '-')}-${id.slice(-4)}`,
      baseBranch,
      progress: 0,
      kanbanColumn: 'backlog',
      canvasPosition: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 },
      canvasSize: { width: 280, height: 220 },
      terminalOutput: [
        '$ claude --continue',
        '> Creating worktree...',
        '> Setting up branch...',
        '> Ready to start',
      ],
      diffSummary: '',
      createdAt: new Date(),
      tags: [],
    }
    set(state => ({ sessions: [...state.sessions, newSession] }))
    get().openTab(id)
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

  approveSession: (id) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id
          ? { ...s, status: 'running' as SessionStatus, terminalOutput: [...s.terminalOutput, '> ✅ Approved, resuming...'] }
          : s
      ),
    })),

  rejectSession: (id) =>
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id
          ? { ...s, status: 'paused' as SessionStatus, terminalOutput: [...s.terminalOutput, '> ❌ Rejected, paused'] }
          : s
      ),
    })),

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
}))
