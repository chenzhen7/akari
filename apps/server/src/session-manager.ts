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
import { SettingsStore } from './settings-store.js'

export interface CreateSessionParams {
  name: string
  task: string
  baseBranch?: string
  agentType?: AgentType
  tags?: string[]
  canvasPosition?: { x: number; y: number }
  parentSessionId?: string
}

interface DbRow {
  id: string
  name: string
  task: string
  status: string
  agent_type: string
  worktree_path: string
  branch_name: string
  base_branch: string
  canvas_x: number
  canvas_y: number
  canvas_width: number
  canvas_height: number
  kanban_column: string
  terminal_id: string
  progress: number
  diff_summary: string
  created_at: string
  tags: string
  collaboration_role: string | null
  parent_session_id: string | null
  child_session_ids: string | null
  last_ai_message: string
  tabs: string
  active_tab_id: string | null
  workspace_id: string
  is_main: number
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
  private readonly db: Database.Database
  private worktreeManager: WorktreeManager
  private readonly terminalMux: TerminalMultiplexer
  private readonly broadcast: (msg: ServerMessage) => void
  private workspaceId: string
  private readonly settingsStore: SettingsStore

  constructor(opts: { repoPath: string; db: Database.Database; broadcast: (msg: ServerMessage) => void; workspaceId: string }) {
    this.db = opts.db
    this.workspaceId = opts.workspaceId
    this.settingsStore = new SettingsStore(opts.db)
    this.worktreeManager = new WorktreeManager(opts.repoPath, this.settingsStore.getWorktreeBaseDir())
    this.terminalMux = new TerminalMultiplexer()
    this.broadcast = opts.broadcast
    this.initDb()
    this.wireEvents()
  }

  async createSession(params: CreateSessionParams): Promise<AgentSession> {
    const id = nanoid(8)
    const mainSession = this.getMainSession()
    const baseBranch = params.baseBranch ?? mainSession?.branchName ?? 'main'
    const safeName = params.name
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase()
      .slice(0, 40)

    const agentType = params.agentType ?? 'claude'

    const session: AgentSession = {
      id,
      name: params.name.trim(),
      task: params.task.trim(),
      status: 'initializing',
      agentType,
      worktreePath: `.agent-worktrees/${id}`,
      branchName: `agent/${safeName}-${id.slice(0, 8)}`,
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
      collaborationRole: 'standalone' as CollaborationRole,
      parentSessionId: params.parentSessionId,
      childSessionIds: [],
      tabs: [],
      activeTabId: null,
      workspaceId: this.workspaceId,
    }

    this.insertRow(session)
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
    this.db
      .prepare('UPDATE sessions SET status = ?, kanban_column = ? WHERE id = ?')
      .run(status, kanbanColumn, sessionId)
    this.broadcast({
      event: 'session:status',
      payload: { id: sessionId, status, progress: session.progress },
    })

    if (status === 'completed') {
      // 后续扩展：可在此接入 pipeline trigger、通知等机制
    }
  }

  getSession(sessionId: string): AgentSession | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as DbRow | undefined
    return row ? rowToSession(row) : null
  }

  getMainSession(): AgentSession | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? AND is_main = 1')
      .get(this.workspaceId) as DbRow | undefined
    return row ? rowToSession(row) : null
  }

  async ensureMainSession(workspacePath: string): Promise<AgentSession> {
    const existing = this.getMainSession()
    if (existing) return existing

    const currentBranch = await this.worktreeManager.getCurrentBranch()
    const id = nanoid(8)
    const session: AgentSession = {
      id,
      name: currentBranch,
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
    this.insertRow(session)
    this.broadcast({ event: 'session:created', payload: session })

    // 主会话监听仓库根目录的文件变更
    this.worktreeManager.watchDiff(
      session.id,
      session.baseBranch,
      this.createDiffCallback(session.id, session.worktreePath),
      session.worktreePath,
      session.worktreePath,
    )

    return session
  }

  listSessions(): AgentSession[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(this.workspaceId) as DbRow[]
    return rows.map(rowToSession)
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
  setWorkspace(workspaceId: string, repoPath: string): void {
    this.workspaceId = workspaceId
    this.worktreeManager = new WorktreeManager(repoPath, this.settingsStore.getWorktreeBaseDir())
  }

  getSettings(): { worktreeBaseDir: string } {
    return { worktreeBaseDir: this.settingsStore.getWorktreeBaseDir() }
  }

  updateSettings(settings: { worktreeBaseDir: string }): void {
    this.settingsStore.setWorktreeBaseDir(settings.worktreeBaseDir)
  }

  getDb(): Database.Database {
    return this.db
  }

  updateCanvasPosition(sessionId: string, x: number, y: number): void {
    this.db.prepare('UPDATE sessions SET canvas_x = ?, canvas_y = ? WHERE id = ?').run(x, y, sessionId)
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
      const terminalTab = s.tabs.find(t => t.type === 'terminal' || t.type === 'claude')
      if (terminalTab?.terminalId) {
        this.terminalMux.sendToTerminal(terminalTab.terminalId, `${message}\n`)
        this.broadcast({ event: 'terminal:data', payload: { sessionId: s.id, terminalId: terminalTab.terminalId, data } })
      }
    }
    return targets.map(s => s.id)
  }

  // ─── Tab management ───────────────────────────────────────────────────────

  createTab(sessionId: string, type: 'terminal' | 'claude' | 'diff' | 'file', filePath?: string): SessionTab {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const tabId = nanoid(6)
    let terminalId: string | undefined
    let label: string

    if (type === 'terminal' || type === 'claude') {
      terminalId = nanoid(8)
      if (type === 'claude') {
        label = 'Claude'
      } else {
        const count = session.tabs.filter(t => t.type === 'terminal').length + 1
        label = `Terminal ${count}`
      }
    } else {
      label = filePath ? path.basename(filePath) : (type === 'file' ? 'File' : 'Diff')
    }

    const tab: SessionTab = { id: tabId, type, label, filePath, terminalId }
    const updatedTabs = [...session.tabs, tab]
    const activeTabId = tabId

    this.db
      .prepare('UPDATE sessions SET tabs = ?, active_tab_id = ? WHERE id = ?')
      .run(JSON.stringify(updatedTabs), activeTabId, sessionId)

    if ((type === 'terminal' || type === 'claude') && terminalId) {
      const worktreePath = session.isMain
        ? session.worktreePath
        : this.worktreeManager.getWorktreePath(sessionId)
      this.terminalMux.createTerminal(terminalId, sessionId, worktreePath)
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

    this.db
      .prepare('UPDATE sessions SET tabs = ?, active_tab_id = ? WHERE id = ?')
      .run(JSON.stringify(updatedTabs), activeTabId, sessionId)

    if ((tab.type === 'terminal' || tab.type === 'claude') && tab.terminalId) {
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

    this.db
      .prepare('UPDATE sessions SET active_tab_id = ? WHERE id = ?')
      .run(tabId, sessionId)

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
    this.db
      .prepare('UPDATE sessions SET tabs = ? WHERE id = ?')
      .run(JSON.stringify(reordered), sessionId)

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
    const cwd = session.isMain ? session.worktreePath : undefined
    return this.worktreeManager.getDiff(sessionId, session.baseBranch, cwd)
  }

  setLastAiMessage(sessionId: string, message: string): void {
    this.db.prepare('UPDATE sessions SET last_ai_message = ? WHERE id = ?').run(message, sessionId)
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
    try {
      this.updateStatus(sessionId, 'archived')
    } catch {
      // already in terminal state
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
    const cwd = session.isMain ? session.worktreePath : undefined
    return this.worktreeManager.getGitLog(sessionId, limit, offset, cwd, branch)
  }

  async getGitBranches(sessionId: string): Promise<GitBranch[]> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return []
    const cwd = session.isMain ? session.worktreePath : undefined
    return this.worktreeManager.getGitBranches(sessionId, cwd)
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return this.worktreeManager.getRepoBranches()
  }

  async commitAll(sessionId: string, message: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.isMain ? session.worktreePath : undefined
    await this.worktreeManager.commitAll(sessionId, message, cwd)
    const log = await this.worktreeManager.getGitLog(sessionId, 100, 0, cwd)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
  }

  async discardAll(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.isMain ? session.worktreePath : undefined
    await this.worktreeManager.discardAll(sessionId, cwd)
  }

  async checkoutBranch(sessionId: string, branch: string, createNew = false): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.isMain ? session.worktreePath : undefined
    await this.worktreeManager.checkoutBranch(sessionId, branch, createNew, cwd)
    if (session.isMain) {
      this.db.prepare('UPDATE sessions SET branch_name = ? WHERE id = ?').run(branch, sessionId)
      const updated = this.getSession(sessionId)
      if (updated) {
        this.broadcast({ event: 'session:updated', payload: updated })
      }
    }
  }

  async worktreeMerge(sessionId: string, sourceBranch: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeManager.mergeToBase(sourceBranch, session.branchName, 'merge')
    const log = await this.worktreeManager.getGitLog(sessionId, 100, 0)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
  }

  async getFileDiffContent(sessionId: string, filePath: string): Promise<{ original: string; modified: string }> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const worktreePath = session.isMain ? session.worktreePath : this.worktreeManager.getWorktreePath(sessionId)
    return this.worktreeManager.getFileDiffContent(worktreePath, session.baseBranch, filePath)
  }

  async getFileDiffLines(sessionId: string, filePath: string): Promise<import('@akari/shared-types').FileDiffLine[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const worktreePath = session.isMain ? session.worktreePath : this.worktreeManager.getWorktreePath(sessionId)
    return this.worktreeManager.getFileDiffLines(worktreePath, session.baseBranch, filePath)
  }

  async listFiles(sessionId: string, relativePath: string): Promise<FileNode[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.isMain ? session.worktreePath : undefined
    return this.worktreeManager.listFiles(sessionId, relativePath, cwd)
  }

  async readFileContent(sessionId: string, filePath: string): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.isMain ? session.worktreePath : undefined
    return this.worktreeManager.readFileContent(sessionId, filePath, cwd)
  }

  async writeFileContent(sessionId: string, filePath: string, content: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    const cwd = session.isMain ? session.worktreePath : undefined
    await this.worktreeManager.writeFileContent(sessionId, filePath, content, cwd)
  }

  async restoreSessions(): Promise<void> {
    const sessions = this.listSessions()

    for (const session of sessions) {
      if (session.isMain) {
        // 主会话：不需要恢复终端，只需启动文件监听（监听仓库根目录）
        if (session.worktreePath) {
          this.worktreeManager.watchDiff(
            session.id,
            session.baseBranch,
            this.createDiffCallback(session.id, session.worktreePath),
            session.worktreePath,
            session.worktreePath,
          )
        }
        continue
      }

      if (session.status === 'initializing') {
        this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('failed', session.id)
        continue
      }

      const needsRestore = ['running', 'waiting', 'paused', 'review', 'idle'].includes(session.status)
      if (!needsRestore || !session.worktreePath) continue

      const worktreePath = this.worktreeManager.getWorktreePath(session.id)
      try {
        await access(worktreePath)
      } catch {
        this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('failed', session.id)
        continue
      }

      // Restore tabs: regenerate terminalIds for terminal tabs and recreate PTYs
      let tabs = session.tabs
      let activeTabId = session.activeTabId
      if (tabs.length === 0) {
        // Legacy session without tabs: create a default terminal tab
        const terminalId = nanoid(8)
        const isClaudeAgent = session.agentType === 'claude' || session.agentType === 'claude-orchestrator'
        const tab: SessionTab = { id: nanoid(6), type: isClaudeAgent ? 'claude' : 'terminal', label: isClaudeAgent ? 'Claude' : 'Terminal 1', terminalId }
        tabs = [tab]
        activeTabId = tab.id
        this.terminalMux.createTerminal(terminalId, session.id, worktreePath)
      } else {
        const restoredTabs: SessionTab[] = []
        for (const tab of tabs) {
          if (tab.type === 'terminal' || tab.type === 'claude') {
            const terminalId = nanoid(8)
            this.terminalMux.createTerminal(terminalId, session.id, worktreePath)
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
      this.db
        .prepare('UPDATE sessions SET tabs = ?, active_tab_id = ? WHERE id = ?')
        .run(JSON.stringify(tabs), activeTabId, session.id)
      this.broadcast({ event: 'tabs:sync', payload: { sessionId: session.id, tabs, activeTabId } })

      this.pushTerminalDisplay(session.id, `\r\n\x1b[33m> [Server restarted — terminal restored]\x1b[0m\r\n`)

      this.worktreeManager.watchDiff(
        session.id,
        session.baseBranch,
        this.createDiffCallback(session.id),
      )
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (session?.isMain) {
      throw new Error('Cannot delete the main session')
    }
    if (session) {
      for (const tab of session.tabs) {
        if (tab.type === 'terminal' && tab.terminalId) {
          this.terminalMux.killTerminal(tab.terminalId)
        }
      }
    }
    await this.worktreeManager.removeWorktree(sessionId, session?.branchName).catch(err => {
      console.warn(`[SessionManager] removeWorktree failed for ${sessionId} during delete (non-fatal):`, err)
    })
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  private async initSession(session: AgentSession): Promise<void> {
    const { id, name, baseBranch } = session
    try {
      this.pushTerminalDisplay(id, '> Creating git worktree...\r\n')

      const { branchName, worktreePath, resolvedBase } = await this.worktreeManager.createWorktree(
        id,
        name,
        baseBranch,
      )

      this.db
        .prepare('UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ? WHERE id = ?')
        .run(worktreePath, branchName, resolvedBase, id)

      this.pushTerminalDisplay(id, `> Branch: ${branchName}\r\n`)
      this.pushTerminalDisplay(id, `> Worktree: ${worktreePath}\r\n`)

      const terminalId = nanoid(8)
      this.terminalMux.createTerminal(terminalId, id, worktreePath)

      const isClaudeAgent = session.agentType === 'claude' || session.agentType === 'claude-orchestrator'
      const tab: SessionTab = { id: nanoid(6), type: isClaudeAgent ? 'claude' : 'terminal', label: isClaudeAgent ? 'Claude' : 'Terminal 1', terminalId }
      session.tabs = [tab]
      session.activeTabId = tab.id
      session.terminalId = terminalId
      this.db
        .prepare('UPDATE sessions SET tabs = ?, active_tab_id = ?, terminal_id = ? WHERE id = ?')
        .run(JSON.stringify([tab]), tab.id, terminalId, id)

      this.broadcast({ event: 'tab:created', payload: { sessionId: id, tab } })
      this.broadcast({ event: 'tab:activated', payload: { sessionId: id, tabId: tab.id } })

      this.pushTerminalDisplay(id, `> Terminal ready (agent: ${session.agentType})\r\n`)

      const adapter = createAgentAdapter(session.agentType)
      if (adapter) {
        this.pushTerminalDisplay(id, `> Launching ${session.agentType}...\r\n`)
        const commands = await adapter.prepare(worktreePath, session.task, id)
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

      this.worktreeManager.watchDiff(id, resolvedBase, this.createDiffCallback(id))

      this.updateStatus(id, 'idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.pushTerminalDisplay(id, `> ❌ Init failed: ${msg}\r\n`)
      try {
        this.updateStatus(id, 'failed')
      } catch {
        // ignore if transition is invalid
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
          try {
            this.updateStatus(sessionId, status)
          } catch {
            // ignore
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
    const terminalId = (activeTab?.type === 'terminal' || activeTab?.type === 'claude') ? activeTab.terminalId : session?.tabs.find(t => t.type === 'terminal' || t.type === 'claude')?.terminalId
    if (terminalId) {
      this.broadcast({ event: 'terminal:data', payload: { sessionId, terminalId, data } })
    }
  }

  private createDiffCallback(sessionId: string, cwd?: string): (diff: GitDiff) => void {
    return (diff: GitDiff) => {
      this.db.prepare('UPDATE sessions SET diff_summary = ? WHERE id = ?').run(JSON.stringify(diff.summary), sessionId)
      this.broadcast({ event: 'diff:update', payload: { sessionId, diff } })
      this.worktreeManager.getGitLog(sessionId, 100, 0, cwd).then(log => {
        this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
      }).catch(() => {
        // git log failure is non-fatal
      })
    }
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        task                TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'initializing',
        agent_type          TEXT NOT NULL DEFAULT 'claude',
        worktree_path       TEXT NOT NULL DEFAULT '',
        branch_name         TEXT NOT NULL DEFAULT '',
        base_branch         TEXT NOT NULL DEFAULT 'main',
        canvas_x            REAL NOT NULL DEFAULT 100,
        canvas_y            REAL NOT NULL DEFAULT 100,
        canvas_width        REAL NOT NULL DEFAULT 280,
        canvas_height       REAL NOT NULL DEFAULT 280,
        kanban_column       TEXT NOT NULL DEFAULT 'backlog',
        terminal_id         TEXT NOT NULL,
        progress            INTEGER NOT NULL DEFAULT 0,
        diff_summary        TEXT NOT NULL DEFAULT '{"additions":0,"deletions":0}',
        created_at          TEXT NOT NULL,
        tags                TEXT NOT NULL DEFAULT '[]',
        pending_approval    TEXT,
        collaboration_role  TEXT NOT NULL DEFAULT 'standalone',
        parent_session_id   TEXT,
        child_session_ids   TEXT NOT NULL DEFAULT '[]',
        last_ai_message    TEXT NOT NULL DEFAULT '',
        tabs               TEXT NOT NULL DEFAULT '[]',
        active_tab_id      TEXT,
        workspace_id       TEXT NOT NULL DEFAULT '',
        is_main            INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Migration: add columns if they don't exist
    const cols: string[] = this.db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .map((row: any) => row.name as string)
    if (!cols.includes('last_ai_message')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_ai_message TEXT NOT NULL DEFAULT ""')
    }
    if (!cols.includes('tabs')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN tabs TEXT NOT NULL DEFAULT "[]"')
    }
    if (!cols.includes('active_tab_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN active_tab_id TEXT')
    }
    if (!cols.includes('workspace_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ""')
    }
    if (!cols.includes('is_main')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0')
    }
    // pending_approval column removed — no longer used
  }

  private insertRow(s: AgentSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, name, task, status, agent_type, worktree_path, branch_name, base_branch,
          canvas_x, canvas_y, canvas_width, canvas_height,
          kanban_column, terminal_id, progress, diff_summary, last_ai_message, created_at, tags,
          collaboration_role, parent_session_id, child_session_ids, tabs, active_tab_id, workspace_id, is_main
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.id,
        s.name,
        s.task,
        s.status,
        s.agentType,
        s.worktreePath,
        s.branchName,
        s.baseBranch,
        s.canvasPosition.x,
        s.canvasPosition.y,
        s.canvasSize.width,
        s.canvasSize.height,
        s.kanbanColumn,
        s.terminalId,
        s.progress,
        JSON.stringify(s.diffSummary),
        s.lastAiMessage,
        s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
        JSON.stringify(s.tags),
        s.collaborationRole,
        s.parentSessionId ?? null,
        JSON.stringify(s.childSessionIds),
        JSON.stringify(s.tabs),
        s.activeTabId,
        s.workspaceId,
        s.isMain ? 1 : 0,
      )
  }
}

function parseDiffSummary(raw: string): { additions: number; deletions: number } {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.additions === 'number' && typeof parsed.deletions === 'number') {
      return parsed
    }
  } catch {
    // fallback: try to parse old string format like "5 insertions(+), 3 deletions(-)"
  }
  const additions = parseInt(raw.match(/(\d+) insertion/)?.[1] ?? '0') || 0
  const deletions = parseInt(raw.match(/(\d+) deletion/)?.[1] ?? '0') || 0
  return { additions, deletions }
}

function rowToSession(r: DbRow): AgentSession {
  return {
    id: r.id,
    name: r.name,
    task: r.task,
    status: r.status as SessionStatus,
    agentType: r.agent_type as AgentType,
    worktreePath: r.worktree_path,
    branchName: r.branch_name,
    baseBranch: r.base_branch,
    canvasPosition: { x: r.canvas_x, y: r.canvas_y },
    canvasSize: { width: r.canvas_width, height: r.canvas_height },
    kanbanColumn: r.kanban_column as KanbanColumn,
    terminalId: r.terminal_id,
    progress: r.progress,
    diffSummary: parseDiffSummary(r.diff_summary),
    lastAiMessage: r.last_ai_message,
    terminalOutput: [],
    createdAt: new Date(r.created_at),
    tags: JSON.parse(r.tags) as string[],
    collaborationRole: (r.collaboration_role ?? 'standalone') as CollaborationRole,
    parentSessionId: r.parent_session_id ?? undefined,
    childSessionIds: JSON.parse(r.child_session_ids ?? '[]') as string[],
    tabs: JSON.parse(r.tabs ?? '[]') as SessionTab[],
    activeTabId: r.active_tab_id ?? null,
    workspaceId: r.workspace_id ?? '',
    isMain: r.is_main === 1,
  }
}

export async function createSessionManager(opts: {
  repoPath: string
  db: Database.Database
  broadcast: (msg: ServerMessage) => void
  workspaceId: string
}): Promise<SessionManager> {
  const manager = new SessionManager(opts)
  await manager.restoreSessions()
  return manager
}
