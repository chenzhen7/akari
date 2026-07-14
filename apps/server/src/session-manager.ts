import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentSession,
  AgentType,
  CollaborationRole,
  FileNode,
  GitBranch,
  GitDiff,
  GitLogResponse,
  KanbanColumn,
  ServerMessage,
  SessionStatus,
  SessionTab,
} from '@akari/shared-types'
import { WorktreeManager } from './worktree-manager.js'
import { TerminalMultiplexer } from './terminal-mux.js'
import { createAgentAdapter, SHELL_STARTUP_DELAY_MS } from './agent-adapters/index.js'
import type { AgentLaunchOptions } from './agent-adapters/base.js'
import { SettingsStore } from './settings-store.js'
import { SessionRepository } from './db/repositories/session.repository.js'

export interface CreateSessionParams {
  name: string
  task: string
  baseBranch?: string
  agentType?: AgentType
  tags?: string[]
  canvasPosition?: { x: number; y: number }
  parentSessionId?: string
}

const STATUS_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  initializing: ['idle', 'failed'],
  running: ['idle', 'waiting', 'paused', 'completed', 'failed', 'archived'],
  idle: ['running', 'failed', 'archived'],
  waiting: ['running', 'paused', 'failed', 'archived'],
  approved: ['running', 'archived'],
  paused: ['running', 'waiting', 'failed', 'archived'],
  review: ['completed', 'running', 'archived'],
  completed: ['merged', 'archived', 'running'],
  failed: ['archived', 'running'],
  merged: ['archived'],
  archived: ['paused'],
}

const STATUS_TO_KANBAN: Partial<Record<SessionStatus, KanbanColumn>> = {
  initializing: 'backlog',
  running: 'in-progress',
  idle: 'backlog',
  waiting: 'waiting-review',
  paused: 'in-progress',
  review: 'waiting-review',
  approved: 'approved',
  completed: 'done',
  failed: 'done',
  merged: 'done',
  archived: 'done',
}

export function validateTransition(from: SessionStatus, to: SessionStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

export class SessionManager {
  /** 文档型 tab（file/diff）的最大保留数量，终端 / agent 类型不受限制 */
  private static readonly MAX_DOC_TABS = 10

  private readonly sessionRepository: SessionRepository
  private repoRoot: string
  private worktreeManager: WorktreeManager
  private readonly terminalMux: TerminalMultiplexer
  private readonly broadcast: (msg: ServerMessage) => void
  private workspaceId: string
  private isGitWorkspace: boolean
  private readonly settingsStore: SettingsStore

  constructor(opts: { workspacePath: string; repoRoot: string; db: Database.Database; broadcast: (msg: ServerMessage) => void; workspaceId: string; isGitWorkspace?: boolean }) {
    this.sessionRepository = new SessionRepository(opts.db)
    this.repoRoot = opts.repoRoot
    this.workspaceId = opts.workspaceId
    this.isGitWorkspace = opts.isGitWorkspace ?? true
    this.settingsStore = new SettingsStore(opts.db)
    this.worktreeManager = new WorktreeManager(opts.repoRoot, opts.workspacePath, this.settingsStore.getWorktreeBaseDir())
    this.terminalMux = new TerminalMultiplexer()
    this.broadcast = opts.broadcast
    this.wireEvents()
  }

  async createSession(params: CreateSessionParams): Promise<AgentSession> {
    if (!this.isGitWorkspace) {
      throw new Error('当前工作区不是 Git 仓库，无法创建 Agent 会话')
    }
    const id = nanoid(8)
    const mainSession = this.getMainSession()
    const baseBranch = params.baseBranch ?? mainSession?.branchName ?? 'main'
    const agentType = params.agentType ?? 'claude'

    const session: AgentSession = {
      id,
      name: params.name.trim(),
      task: params.task.trim(),
      status: 'initializing',
      agentType,
      worktreePath: '',
      branchName: `agent/${id.slice(0, 8)}`,
      baseBranch,
      canvasPosition: params.canvasPosition ?? {
        x: 100 + Math.random() * 600,
        y: 100 + Math.random() * 400,
      },
      canvasSize: { width: 280, height: 280 },
      kanbanColumn: 'backlog',
      terminalId: nanoid(8),
      progress: 0,
      terminalOutput: [],
      lastAiMessage: '',
      diffSummary: { additions: 0, deletions: 0 },
      createdAt: new Date(),
      tags: params.tags ?? [],
      collaborationRole: 'standalone',
      parentSessionId: params.parentSessionId,
      childSessionIds: [],
      tabs: [],
      activeTabId: null,
      workspaceId: this.workspaceId,
    }

    this.sessionRepository.create(session)
    this.broadcast({ event: 'session:created', payload: session })

    this.initSession(session).catch(err => {
      console.error(`[SessionManager] init failed for ${id}:`, err)
    })

    return session
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (!validateTransition(session.status, status)) {
      throw new Error(`Invalid transition: ${session.status} → ${status}`)
    }
    const kanbanColumn = STATUS_TO_KANBAN[status] ?? session.kanbanColumn
    this.sessionRepository.updateStatus(sessionId, status, kanbanColumn)
    this.broadcast({
      event: 'session:status',
      payload: { id: sessionId, status, progress: session.progress },
    })

    if (status === 'completed') {
      // 后续扩展：可在此接入 pipeline trigger、通知等机制
    }
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessionRepository.getById(sessionId)
  }

  getMainSession(): AgentSession | null {
    return this.sessionRepository.getMainByWorkspaceId(this.workspaceId)
  }

  async ensureMainSession(workspacePath: string): Promise<AgentSession> {
    const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? '主工作区'
    const existing = this.getMainSession()
    if (existing) {
      if (this.isGitWorkspace) {
        this.watchMainBranch(existing.id, this.repoRoot)
        // Re-read current branch in case it changed while this workspace was not active
        const currentBranch = await this.worktreeManager.getCurrentBranch()
        if (currentBranch !== existing.branchName) {
          this.sessionRepository.updateBranchAndBase(existing.id, currentBranch, currentBranch)
          const updated = this.getSession(existing.id)
          if (updated) {
            this.broadcast({ event: 'session:updated', payload: updated })
          }
        }
      } else {
        // Non-git workspace: clear branch/diff from the main session
        const needsClear =
          existing.branchName !== '' ||
          existing.baseBranch !== '' ||
          existing.diffSummary.additions !== 0 ||
          existing.diffSummary.deletions !== 0 ||
          existing.name !== workspaceName
        if (needsClear) {
          this.sessionRepository.updateMainSessionClear(existing.id, workspaceName)
          const updated = this.getSession(existing.id)
          if (updated) {
            this.broadcast({ event: 'session:updated', payload: updated })
          }
        }
      }
      return this.getMainSession()!
    }

    const currentBranch = this.isGitWorkspace ? await this.worktreeManager.getCurrentBranch() : ''
    const sessionName = workspaceName
    const id = nanoid(8)
    const session: AgentSession = {
      id,
      name: sessionName,
      task: '主分支',
      status: 'idle',
      agentType: 'shell',
      worktreePath: workspacePath,
      branchName: currentBranch,
      baseBranch: currentBranch,
      canvasPosition: { x: 50, y: 50 },
      canvasSize: { width: 280, height: 280 },
      kanbanColumn: 'backlog',
      terminalId: '',
      progress: 0,
      terminalOutput: [],
      lastAiMessage: '',
      diffSummary: { additions: 0, deletions: 0 },
      createdAt: new Date(),
      tags: [],
      collaborationRole: 'standalone',
      childSessionIds: [],
      tabs: [],
      activeTabId: null,
      workspaceId: this.workspaceId,
      isMain: true,
    }
    this.sessionRepository.create(session)
    this.broadcast({ event: 'session:created', payload: session })

    // 主会话监听仓库根目录的文件变更
    this.worktreeManager.watchDiff(
      session.id,
      this.createDiffCallbacks(session.id, session.worktreePath),
      session.worktreePath,
      session.worktreePath,
    )

    if (this.isGitWorkspace) {
      this.watchMainBranch(session.id, this.repoRoot)
    }

    return session
  }

  listSessions(): AgentSession[] {
    return this.sessionRepository.listByWorkspaceId(this.workspaceId)
  }

  sendToTerminal(terminalId: string, data: string): void {
    this.terminalMux.sendToTerminal(terminalId, data)
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    this.terminalMux.resizeTerminal(terminalId, cols, rows)
  }

  getTerminalBuffer(terminalId: string): string[] {
    return this.terminalMux.getBuffer(terminalId)
  }

  /** Expose db for CanvasEdgeStore — only used within the same process */
  async setWorkspace(workspaceId: string, workspacePath: string, repoRoot: string, isGitWorkspace = true): Promise<void> {
    await this.worktreeManager.dispose()
    this.workspaceId = workspaceId
    this.repoRoot = repoRoot
    this.isGitWorkspace = isGitWorkspace
    this.worktreeManager = new WorktreeManager(repoRoot, workspacePath, this.settingsStore.getWorktreeBaseDir())
  }

  getSettings(): { worktreeBaseDir: string } {
    return { worktreeBaseDir: this.settingsStore.getWorktreeBaseDir() }
  }

  updateSettings(settings: { worktreeBaseDir: string }): void {
    this.settingsStore.setWorktreeBaseDir(settings.worktreeBaseDir)
  }

  updateCanvasPosition(sessionId: string, x: number, y: number): void {
    this.sessionRepository.updateCanvasPosition(sessionId, x, y)
  }

  broadcastMessage(msg: ServerMessage): void {
    this.broadcast(msg)
  }

  broadcastMessage_legacy(message: string, sessionIds?: string[]): string[] {
    const sessions = this.listSessions()
    const active = sessions.filter(s => ['running', 'waiting'].includes(s.status))
    const targets = sessionIds ? active.filter(s => sessionIds.includes(s.id)) : active
    for (const s of targets) {
      const data = `\r\n📢 Broadcast: ${message}\r\n`
      const terminalTab = s.tabs.find(t => t.type === 'terminal' || t.type === 'agent')
      if (terminalTab?.terminalId) {
        this.terminalMux.sendToTerminal(terminalTab.terminalId, `${message}\n`)
        this.broadcast({ event: 'terminal:data', payload: { sessionId: s.id, terminalId: terminalTab.terminalId, data } })
      }
    }
    return targets.map(s => s.id)
  }

  // ─── Tab management ───────────────────────────────────────────────────────

  createTab(
    sessionId: string,
    type: 'terminal' | 'agent' | 'diff' | 'file',
    filePath?: string,
    agentType?: AgentType,
    launchOptions?: AgentLaunchOptions,
  ): SessionTab {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const tabId = nanoid(6)
    let terminalId: string | undefined
    let resolvedType: SessionTab['type'] = type
    let label: string

    if (type === 'terminal' || type === 'agent') {
      terminalId = nanoid(8)
      const adapter = agentType ? createAgentAdapter(agentType) : null
      if (type === 'agent' && adapter?.isAutomated) {
        label = adapter.getTabLabel()
      } else {
        resolvedType = 'terminal'
        const count = session.tabs.filter(t => t.type === 'terminal').length + 1
        label = `Terminal ${count}`
      }
    } else {
      label = filePath ? path.basename(filePath) : (type === 'file' ? 'File' : 'Diff')
    }

    const tab: SessionTab = { id: tabId, type: resolvedType, label, filePath, terminalId, agentType }
    let updatedTabs = [...session.tabs, tab]
    const activeTabId = tabId

    // 文档型 tab（file/diff）最多保留 MAX_DOC_TABS 个：超出时按插入顺序淘汰最旧的，
    // 终端 / agent（terminal/agent）类型不受此限制。
    const evictedTabIds: string[] = []
    if (resolvedType === 'file' || resolvedType === 'diff') {
      const isDocTab = (t: SessionTab): boolean => t.type === 'file' || t.type === 'diff'
      let docCount = updatedTabs.filter(isDocTab).length
      while (docCount > SessionManager.MAX_DOC_TABS) {
        // 找最旧的、且不是刚新建的那个文档型 tab 淘汰
        const victim = updatedTabs.find(t => isDocTab(t) && t.id !== tabId)
        if (!victim) break
        evictedTabIds.push(victim.id)
        updatedTabs = updatedTabs.filter(t => t.id !== victim.id)
        docCount--
      }
    }

    this.sessionRepository.updateTabs(sessionId, updatedTabs, activeTabId)

    for (const evictedId of evictedTabIds) {
      this.broadcast({ event: 'tab:closed', payload: { sessionId, tabId: evictedId } })
    }

    if ((resolvedType === 'terminal' || resolvedType === 'agent') && terminalId) {
      this.terminalMux.createTerminal(terminalId, sessionId, session.worktreePath)
      if (agentType) {
        this.launchAgentInTerminal(sessionId, terminalId, session.worktreePath, agentType, session.task, launchOptions).catch(err => {
          console.error(`[SessionManager] launchAgentInTerminal failed for ${sessionId}:`, err)
        })
      }
    }

    this.broadcast({ event: 'tab:created', payload: { sessionId, tab } })
    this.broadcast({ event: 'tab:activated', payload: { sessionId, tabId } })

    return tab
  }

  closeTab(sessionId: string, tabId: string): void {
    const session = this.getSession(sessionId)
    if (!session) return

    const tab = session.tabs.find(t => t.id === tabId)
    if (!tab) return

    const updatedTabs = session.tabs.filter(t => t.id !== tabId)
    let activeTabId = session.activeTabId
    if (activeTabId === tabId) {
      activeTabId = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null
    }

    this.sessionRepository.updateTabs(sessionId, updatedTabs, activeTabId)

    if ((tab.type === 'terminal' || tab.type === 'agent') && tab.terminalId) {
      this.terminalMux.killTerminal(tab.terminalId)
    }

    this.broadcast({ event: 'tab:closed', payload: { sessionId, tabId } })
    if (activeTabId && activeTabId !== session.activeTabId) {
      this.broadcast({ event: 'tab:activated', payload: { sessionId, tabId: activeTabId } })
    }
  }

  activateTab(sessionId: string, tabId: string): void {
    const session = this.getSession(sessionId)
    if (!session || !session.tabs.find(t => t.id === tabId)) return

    this.sessionRepository.updateActiveTab(sessionId, tabId)

    this.broadcast({ event: 'tab:activated', payload: { sessionId, tabId } })
  }

  reorderTabs(sessionId: string, orderedTabIds: string[]): void {
    const session = this.getSession(sessionId)
    if (!session) return

    const tabMap = new Map(session.tabs.map(t => [t.id, t]))
    if (orderedTabIds.length !== session.tabs.length || !orderedTabIds.every(id => tabMap.has(id))) {
      return
    }

    const reordered = orderedTabIds.map(id => tabMap.get(id)!)
    this.sessionRepository.updateTabs(sessionId, reordered)

    this.broadcast({
      event: 'tabs:sync',
      payload: { sessionId, tabs: reordered, activeTabId: session.activeTabId },
    })
  }

  getTabs(sessionId: string): SessionTab[] {
    return this.getSession(sessionId)?.tabs ?? []
  }

  async getCurrentDiff(sessionId: string): Promise<GitDiff> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) {
      return { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    }
    return this.worktreeManager.getDiff(sessionId, session.worktreePath)
  }

  setLastAiMessage(sessionId: string, message: string): void {
    this.sessionRepository.updateLastAiMessage(sessionId, message)
  }

  pushTerminalMessage(sessionId: string, data: string): void {
    this.pushTerminalDisplay(sessionId, data)
  }

  archiveSession(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (session?.isMain) {
      throw new Error('Cannot archive the main session')
    }
    if (session) {
      for (const tab of session.tabs) {
        if (tab.type === 'terminal' && tab.terminalId) {
          this.terminalMux.killTerminal(tab.terminalId)
        }
      }
    }
    if (session && validateTransition(session.status, 'archived')) {
      this.updateStatus(sessionId, 'archived')
    }
  }

  restoreSession(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (!session || session.status !== 'archived') return
    this.updateStatus(sessionId, 'paused')
  }

  async getGitLog(sessionId: string, limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return { commits: [], branches: [], head: '' }
    return this.worktreeManager.getGitLog(sessionId, limit, offset, session.worktreePath, branch)
  }

  async getGitBranches(sessionId: string): Promise<GitBranch[]> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return []
    return this.worktreeManager.getGitBranches(sessionId, session.worktreePath)
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return this.worktreeManager.getRepoBranches()
  }

  async commitAll(sessionId: string, message: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeManager.commitAll(sessionId, message, session.worktreePath)
    const log = await this.worktreeManager.getGitLog(sessionId, 100, 0, session.worktreePath)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
    this.broadcastDiffUpdate(sessionId)
  }

  async discardAll(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeManager.discardAll(sessionId, session.worktreePath)
    this.broadcastDiffUpdate(sessionId)
  }

  async discardFile(sessionId: string, filePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeManager.discardFile(sessionId, filePath, session.worktreePath)
    this.broadcastDiffUpdate(sessionId)
  }

  async checkoutBranch(sessionId: string, branch: string, createNew = false): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeManager.checkoutBranch(sessionId, branch, createNew, session.worktreePath)
    if (session.isMain) {
      this.sessionRepository.updateBranch(sessionId, branch)
      const updated = this.getSession(sessionId)
      if (updated) {
        this.broadcast({ event: 'session:updated', payload: updated })
      }
    }
    this.broadcastDiffUpdate(sessionId)
  }

  async worktreeMerge(sessionId: string, sourceBranch: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.isMain) {
      throw new Error('Cannot merge the main session into itself')
    }
    const mainSession = this.getMainSession()
    if (!mainSession?.worktreePath) {
      throw new Error('Main session not found or has no worktree')
    }
    const branchToMerge = session.branchName || sourceBranch
    await this.worktreeManager.mergeIntoCurrentBranch(mainSession.worktreePath, branchToMerge, 'merge')
    const log = await this.worktreeManager.getGitLog(mainSession.id, 100, 0, mainSession.worktreePath)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId: mainSession.id, ...log } })
    this.broadcastDiffUpdate(mainSession.id)
  }

  async updateFromBase(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.isMain) {
      throw new Error('Cannot update the main session from itself')
    }
    const mainSession = this.getMainSession()
    if (!mainSession?.worktreePath) {
      throw new Error('Main session not found or has no worktree')
    }
    await this.worktreeManager.updateFromBase(sessionId, mainSession.branchName, session.worktreePath)
    const log = await this.worktreeManager.getGitLog(sessionId, 100, 0, session.worktreePath)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
    this.broadcastDiffUpdate(sessionId)
  }

  async getFileDiffContent(sessionId: string, filePath: string): Promise<{ original: string; modified: string }> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeManager.getFileDiffContent(session.worktreePath, filePath)
  }

  async getFileDiffLines(sessionId: string, filePath: string): Promise<import('@akari/shared-types').FileDiffLine[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeManager.getFileDiffLines(session.worktreePath, filePath)
  }

  async listFiles(sessionId: string, relativePath: string): Promise<FileNode[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeManager.listFiles(sessionId, relativePath, session.worktreePath)
  }

  async readFileContent(sessionId: string, filePath: string): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeManager.readFileContent(sessionId, filePath, session.worktreePath)
  }

  async writeFileContent(sessionId: string, filePath: string, content: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeManager.writeFileContent(sessionId, filePath, content, session.worktreePath)
  }

  async restoreSessions(): Promise<void> {
    const sessions = this.listSessions()

    for (const session of sessions) {
      // 所有会话（包括主会话）都需要恢复 terminal/agent tab；主会话额外监听仓库根目录 diff
      if (session.isMain) {
        if (session.worktreePath && this.isGitWorkspace) {
          this.worktreeManager.watchDiff(
            session.id,
            this.createDiffCallbacks(session.id, session.worktreePath),
            session.worktreePath,
            session.worktreePath,
          )
        }
      }

      // 主会话不参与状态机清理；非主会话按状态处理
      if (!session.isMain) {
        if (session.status === 'initializing') {
          if (validateTransition(session.status, 'failed')) {
            this.sessionRepository.updateStatusOnly(session.id, 'failed')
          } else {
            this.broadcast({
              event: 'session:status',
              payload: { id: session.id, status: session.status, progress: session.progress },
            })
          }
          this.clearSessionTerminalIds(session.id)
          continue
        }

        const terminalStatuses: SessionStatus[] = ['completed', 'failed', 'merged', 'archived']
        if (terminalStatuses.includes(session.status)) {
          this.clearSessionTerminalIds(session.id)
          continue
        }

        const needsRestore = ['running', 'waiting', 'paused', 'review', 'idle', 'approved'].includes(session.status)
        if (!needsRestore || !session.worktreePath) {
          this.clearSessionTerminalIds(session.id)
          continue
        }

        try {
          await access(session.worktreePath)
        } catch {
          if (validateTransition(session.status, 'failed')) {
            this.sessionRepository.updateStatusOnly(session.id, 'failed')
          }
          this.clearSessionTerminalIds(session.id)
          continue
        }
      }

      // 恢复 tabs：为 terminal/agent tab 重新生成 terminalId 并创建 PTY
      let tabs = session.tabs
      let activeTabId = session.activeTabId
      if (tabs.length === 0) {
        // Legacy session without tabs: create a default terminal/agent tab
        const terminalId = nanoid(8)
        const adapter = createAgentAdapter(session.agentType)
        const isAgent = adapter.isAutomated
        const tab: SessionTab = {
          id: nanoid(6),
          type: isAgent ? 'agent' : 'terminal',
          label: isAgent ? adapter.getTabLabel() : 'Terminal 1',
          terminalId,
          agentType: session.agentType,
        }
        tabs = [tab]
        activeTabId = tab.id
        this.terminalMux.createTerminal(terminalId, session.id, session.worktreePath)
      } else {
        const restoredTabs: SessionTab[] = []
        for (const tab of tabs) {
          if (tab.type === 'terminal' || tab.type === 'agent') {
            const terminalId = nanoid(8)
            this.terminalMux.createTerminal(terminalId, session.id, session.worktreePath)
            restoredTabs.push({ ...tab, terminalId })
          } else {
            restoredTabs.push(tab)
          }
        }
        tabs = restoredTabs
        // Reset active tab if it no longer exists
        if (activeTabId && !tabs.find(t => t.id === activeTabId)) {
          activeTabId = tabs.length > 0 ? tabs[0].id : null
        }
      }

      const terminalId = this.resolveSessionTerminalId(tabs, activeTabId)
      this.sessionRepository.updateTerminalIdAndTabs(session.id, tabs, activeTabId, terminalId ?? '')
      this.broadcast({ event: 'tabs:sync', payload: { sessionId: session.id, tabs, activeTabId } })

      this.pushTerminalDisplay(session.id, `\r\n\x1b[33m> [Server restarted — terminal restored]\x1b[0m\r\n`)

      if (!session.isMain) {
        this.worktreeManager.watchDiff(
          session.id,
          this.createDiffCallbacks(session.id),
        )
      }
    }
  }

  private resolveSessionTerminalId(tabs: SessionTab[], activeTabId: string | null): string | undefined {
    const activeTab = tabs.find(t => t.id === activeTabId)
    if ((activeTab?.type === 'terminal' || activeTab?.type === 'agent') && activeTab.terminalId) {
      return activeTab.terminalId
    }
    return tabs.find(t => (t.type === 'terminal' || t.type === 'agent') && t.terminalId)?.terminalId
  }

  private clearSessionTerminalIds(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (!session) return

    let changed = false
    const clearedTabs = session.tabs.map(tab => {
      if ((tab.type === 'terminal' || tab.type === 'agent') && tab.terminalId) {
        this.terminalMux.killTerminal(tab.terminalId)
        changed = true
        return { ...tab, terminalId: undefined }
      }
      return tab
    })

    if (!changed && !session.terminalId) return

    this.sessionRepository.updateTabsAndTerminalId(sessionId, clearedTabs, '')
    this.broadcast({ event: 'tabs:sync', payload: { sessionId, tabs: clearedTabs, activeTabId: session.activeTabId } })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (session?.isMain) {
      throw new Error('Cannot delete the main session')
    }
    if (!session) {
      this.sessionRepository.delete(sessionId)
      return
    }
    for (const tab of session.tabs) {
      if (tab.type === 'terminal' && tab.terminalId) {
        this.terminalMux.killTerminal(tab.terminalId)
      }
    }
    await this.worktreeManager.removeWorktree(sessionId, session.worktreePath, session.branchName).catch(err => {
      console.warn(`[SessionManager] removeWorktree failed for ${sessionId} during delete (non-fatal):`, err)
    })
    this.sessionRepository.delete(sessionId)
  }

  private async launchAgentInTerminal(
    sessionId: string,
    terminalId: string,
    worktreePath: string,
    agentType: AgentType,
    task: string,
    launchOptions?: AgentLaunchOptions,
  ): Promise<void> {
    const adapter = createAgentAdapter(agentType)
    if (!adapter.isAutomated) return

    this.pushTerminalDisplay(sessionId, `> Launching ${agentType}...\r\n`)
    const commands = await adapter.prepare(worktreePath, task, sessionId, launchOptions)
    let cumulativeDelay = SHELL_STARTUP_DELAY_MS
    for (const { cmd, delayMs = 0 } of commands) {
      cumulativeDelay += delayMs
      const delay = cumulativeDelay
      setTimeout(() => {
        if (this.terminalMux.hasTerminal(terminalId)) {
          this.terminalMux.sendToTerminal(terminalId, cmd)
        }
      }, delay)
    }
  }

  private async initSession(session: AgentSession): Promise<void> {
    const { id, baseBranch } = session
    try {
      this.pushTerminalDisplay(id, '> Creating git worktree...\r\n')

      const { branchName, worktreePath, resolvedBase } = await this.worktreeManager.createWorktree(
        id,
        baseBranch,
      )

      session.worktreePath = worktreePath
      session.branchName = branchName
      session.baseBranch = resolvedBase

      this.sessionRepository.updateWorktreeAndBranch(id, worktreePath, branchName, resolvedBase)

      this.broadcast({ event: 'session:updated', payload: session })

      this.pushTerminalDisplay(id, `> Branch: ${branchName}\r\n`)
      this.pushTerminalDisplay(id, `> Worktree: ${worktreePath}\r\n`)

      const terminalId = nanoid(8)
      this.terminalMux.createTerminal(terminalId, id, worktreePath)

      const adapter = createAgentAdapter(session.agentType)
      const isAgent = adapter.isAutomated
      const tab: SessionTab = {
        id: nanoid(6),
        type: isAgent ? 'agent' : 'terminal',
        label: isAgent ? adapter.getTabLabel() : 'Terminal 1',
        terminalId,
        agentType: session.agentType,
      }
      session.tabs = [tab]
      session.activeTabId = tab.id
      session.terminalId = terminalId
      this.sessionRepository.updateTerminalIdAndTabs(id, [tab], tab.id, terminalId)

      this.broadcast({ event: 'tab:created', payload: { sessionId: id, tab } })
      this.broadcast({ event: 'tab:activated', payload: { sessionId: id, tabId: tab.id } })

      this.pushTerminalDisplay(id, `> Terminal ready (agent: ${session.agentType})\r\n`)

      await this.launchAgentInTerminal(id, terminalId, worktreePath, session.agentType, session.task)

      this.worktreeManager.watchDiff(id, this.createDiffCallbacks(id))

      this.updateStatus(id, 'idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.pushTerminalDisplay(id, `> ❌ Init failed: ${msg}\r\n`)
      const session = this.getSession(id)
      if (session && validateTransition(session.status, 'failed')) {
        this.updateStatus(id, 'failed')
      }
    }
  }

  private wireEvents(): void {
    this.terminalMux.on(
      'terminal:data',
      ({ sessionId, terminalId, data }: { sessionId: string; terminalId: string; data: string }) => {
        this.broadcast({ event: 'terminal:data', payload: { sessionId, terminalId, data } })
      },
    )

    this.terminalMux.on(
      'terminal:ready',
      ({ sessionId, terminalId }: { sessionId: string; terminalId: string }) => {
        this.broadcast({ event: 'terminal:ready', payload: { sessionId, terminalId } })
      },
    )

    this.terminalMux.on(
      'terminal:exit',
      ({ sessionId, terminalId, exitCode }: { sessionId: string; terminalId: string; exitCode: number }) => {
        const session = this.getSession(sessionId)
        if (!session || !['running', 'paused'].includes(session.status)) return
        // Only update status if the exited terminal is the last one or the active one
        const remaining = session.tabs.filter(t => t.type === 'terminal' && t.terminalId && t.terminalId !== terminalId)
        if (remaining.length === 0) {
          const status: SessionStatus = exitCode === 0 ? 'completed' : 'failed'
          if (validateTransition(session.status, status)) {
            this.updateStatus(sessionId, status)
          }
        }
      },
    )

    this.terminalMux.on(
      'terminal:resized',
      ({ sessionId, terminalId }: { sessionId: string; terminalId: string }) => {
        this.broadcast({ event: 'terminal:resized', payload: { sessionId, terminalId } })
      },
    )

  }

  private pushTerminalDisplay(sessionId: string, data: string): void {
    const session = this.getSession(sessionId)
    const activeTab = session?.tabs.find(t => t.id === session.activeTabId)
    const terminalId = (activeTab?.type === 'terminal' || activeTab?.type === 'agent') ? activeTab.terminalId : session?.tabs.find(t => t.type === 'terminal' || t.type === 'agent')?.terminalId
    if (terminalId) {
      this.broadcast({ event: 'terminal:data', payload: { sessionId, terminalId, data } })
    }
  }

  refreshDiff(sessionId: string): void {
    this.broadcastDiffUpdate(sessionId)
  }

  private broadcastDiffUpdate(sessionId: string): void {
    void this.getCurrentDiff(sessionId).then(diff => {
      this.sessionRepository.updateDiffSummary(sessionId, diff.summary)
      this.broadcast({ event: 'diff:update', payload: { sessionId, diff } })
    }).catch((err: unknown) => {
      console.warn(`[SessionManager] failed to broadcast diff update for ${sessionId}:`, err)
    })
  }

  private createDiffCallbacks(sessionId: string, cwd?: string): {
    onDiff: (diff: GitDiff) => void
    onFileChange: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
  } {
    return {
      onDiff: (diff: GitDiff) => {
        this.sessionRepository.updateDiffSummary(sessionId, diff.summary)
        this.broadcast({ event: 'diff:update', payload: { sessionId, diff } })
        this.worktreeManager.getGitLog(sessionId, 100, 0, cwd).then(log => {
          this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
        }).catch((err: unknown) => {
          console.warn(`[SessionManager] git log failure after diff update for ${sessionId}:`, err)
        })
      },
      onFileChange: (filePath: string, changeType: 'add' | 'change' | 'unlink') => {
        this.broadcast({ event: 'file:update', payload: { sessionId, filePath, changeType } })
      },
    }
  }

  private watchMainBranch(sessionId: string, repoRoot: string): void {
    this.worktreeManager.watchGitMetadata(sessionId, repoRoot, () => {
      void (async () => {
        const session = this.getSession(sessionId)
        if (!session || !session.isMain) return
        const branch = await this.worktreeManager.getCurrentBranch(repoRoot)
        if (branch !== session.branchName) {
          this.sessionRepository.updateBranchAndBase(sessionId, branch, branch)
          const updated = this.getSession(sessionId)
          if (updated) {
            this.broadcast({ event: 'session:updated', payload: updated })
          }
        }
        // Refresh diff after any external git operation (commit, reset, checkout, etc.)
        this.broadcastDiffUpdate(sessionId)
      })()
    })
  }

}

export async function createSessionManager(opts: {
  workspacePath: string
  repoRoot: string
  db: Database.Database
  broadcast: (msg: ServerMessage) => void
  workspaceId: string
  isGitWorkspace?: boolean
}): Promise<SessionManager> {
  const manager = new SessionManager(opts)
  await manager.restoreSessions()
  return manager
}
