import Database from 'better-sqlite3'
import type { AgentSession, AgentType, FileNode, GitBranch, GitDiff, GitLogResponse, ServerMessage, SessionStatus, SessionTab } from '@akari/shared-types'
import { GitCommandRunner } from './infrastructure/git/git-command-runner.js'
import { GitRepositoryDetector } from './infrastructure/git/git-repository-detector.js'
import { GitRepositoryRegistry } from './infrastructure/git/git-repository-registry.js'
import { TerminalMultiplexer } from './infrastructure/pty/terminal-multiplexer.js'
import { FileSystemService } from './infrastructure/fs/file-system.service.js'
import { SessionRepository } from './infrastructure/db/repositories/session.repository.js'
import { SettingsStore } from './infrastructure/db/settings-store.js'
import { GitQueryService } from './services/git-query.service.js'
import { SessionLifecycleService, type CreateSessionParams } from './services/session-lifecycle.service.js'
import { TabService } from './services/tab.service.js'
import { TerminalService } from './services/terminal.service.js'
import { WorktreeService } from './services/worktree.service.js'
import { isTerminalLikeTab } from './services/tab-utils.js'
import { validateTransition } from './core/session-state-machine.js'

export { validateTransition, CreateSessionParams }

export class SessionManager {
  private readonly sessionLifecycle: SessionLifecycleService
  private readonly tabService: TabService
  private readonly terminalService: TerminalService
  private readonly worktreeService: WorktreeService
  private readonly gitQuery: GitQueryService
  private readonly fileService: FileSystemService
  private readonly terminalMux: TerminalMultiplexer
  private readonly sessionRepository: SessionRepository
  private readonly settingsStore: SettingsStore
  private readonly broadcast: (msg: ServerMessage) => void
  private disposed = false

  constructor(opts: { workspacePath: string; repoRoot: string; db: Database.Database; broadcast: (msg: ServerMessage) => void; workspaceId: string; isGitWorkspace?: boolean }) {
    this.broadcast = opts.broadcast
    this.sessionRepository = new SessionRepository(opts.db)
    this.settingsStore = new SettingsStore(opts.db)
    const worktreeBaseDir = this.settingsStore.getWorktreeBaseDir()

    this.fileService = new FileSystemService(opts.repoRoot, opts.workspacePath, worktreeBaseDir)
    const runner = new GitCommandRunner()
    const detector = new GitRepositoryDetector(opts.repoRoot, opts.workspacePath, worktreeBaseDir)
    const registry = new GitRepositoryRegistry(detector, runner)
    this.gitQuery = new GitQueryService(opts.repoRoot, registry)
    this.worktreeService = new WorktreeService(opts.repoRoot, opts.workspacePath, worktreeBaseDir, this.fileService, this.gitQuery, registry, runner, detector)
    this.terminalMux = new TerminalMultiplexer()
    this.terminalService = new TerminalService(this.terminalMux)
    this.tabService = new TabService(this.sessionRepository, this.terminalService, opts.broadcast)
    this.sessionLifecycle = new SessionLifecycleService(
      {
        workspaceId: opts.workspaceId,
        repoRoot: opts.repoRoot,
        workspacePath: opts.workspacePath,
        isGitWorkspace: opts.isGitWorkspace,
      },
      this.sessionRepository,
      this.settingsStore,
      this.worktreeService,
      this.tabService,
      this.terminalService,
      opts.broadcast,
    )

    this.wireEvents()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    await this.worktreeService.dispose().catch((err: unknown) => {
      console.error(`[SessionManager] worktreeService.dispose failed:`, err)
    })

    this.terminalService.dispose()
  }

  private guardDisposed(): void {
    if (this.disposed) {
      throw new Error(`SessionManager has been disposed`)
    }
  }

  async createSession(params: CreateSessionParams): Promise<AgentSession> {
    this.guardDisposed()
    return this.sessionLifecycle.createSession(params)
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    this.guardDisposed()
    this.sessionLifecycle.updateStatus(sessionId, status)
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessionLifecycle.getSession(sessionId)
  }

  getMainSession(): AgentSession | null {
    return this.sessionLifecycle.getMainSession()
  }

  async ensureMainSession(workspacePath: string): Promise<AgentSession> {
    return this.sessionLifecycle.ensureMainSession(workspacePath)
  }

  listSessions(): AgentSession[] {
    return this.sessionLifecycle.listSessions()
  }

  sendToTerminal(terminalId: string, data: string): void {
    this.guardDisposed()
    this.terminalService.sendToTerminal(terminalId, data)
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    this.guardDisposed()
    this.terminalService.resizeTerminal(terminalId, cols, rows)
  }

  getTerminalBuffer(terminalId: string): string[] {
    return this.terminalService.getBuffer(terminalId)
  }

  async setWorkspace(workspaceId: string, workspacePath: string, repoRoot: string, isGitWorkspace = true): Promise<void> {
    await this.worktreeService.dispose()
    this.sessionLifecycle.setWorkspace(workspaceId, workspacePath, repoRoot, isGitWorkspace)
    // NOTE: fileService / gitQuery / worktreeService still reference the old workspace paths.
    // A full rebuild is left as follow-up if hot workspace switching becomes necessary.
  }

  getSettings(): { worktreeBaseDir: string } {
    return this.sessionLifecycle.getSettings()
  }

  updateSettings(settings: { worktreeBaseDir: string }): void {
    this.sessionLifecycle.updateSettings(settings)
  }

  updateCanvasPosition(sessionId: string, x: number, y: number): void {
    this.sessionLifecycle.updateCanvasPosition(sessionId, x, y)
  }

  broadcastMessage(msg: ServerMessage): void {
    this.sessionLifecycle.broadcastMessage(msg)
  }

  broadcastMessage_legacy(message: string, sessionIds?: string[]): string[] {
    const sessions = this.listSessions()
    const active = sessions.filter(s => ['running', 'waiting'].includes(s.status))
    const targets = sessionIds ? active.filter(s => sessionIds.includes(s.id)) : active
    for (const s of targets) {
      const data = `\r\n📢 Broadcast: ${message}\r\n`
      const terminalTab = s.tabs.find(isTerminalLikeTab)
      if (terminalTab?.terminalId) {
        this.terminalService.sendToTerminal(terminalTab.terminalId, `${message}\n`)
        this.broadcast({ event: 'terminal:data', payload: { sessionId: s.id, terminalId: terminalTab.terminalId, data } })
      }
    }
    return targets.map(s => s.id)
  }

  createTab(
    sessionId: string,
    type: 'terminal' | 'agent' | 'diff' | 'file' | 'review',
    filePath?: string,
    agentType?: AgentType,
    launchOptions?: import('./agent-adapters/base.js').AgentLaunchOptions,
  ): SessionTab {
    this.guardDisposed()
    return this.tabService.createTab(sessionId, type, filePath, agentType, launchOptions)
  }

  closeTab(sessionId: string, tabId: string): void {
    this.tabService.closeTab(sessionId, tabId)
  }

  activateTab(sessionId: string, tabId: string): void {
    this.tabService.activateTab(sessionId, tabId)
  }

  reorderTabs(sessionId: string, orderedTabIds: string[]): void {
    this.tabService.reorderTabs(sessionId, orderedTabIds)
  }

  getTabs(sessionId: string): SessionTab[] {
    return this.tabService.getTabs(sessionId)
  }

  async getCurrentDiff(sessionId: string): Promise<GitDiff> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) {
      return { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    }
    return this.worktreeService.getCurrentDiff(session.worktreePath)
  }

  setLastAiMessage(sessionId: string, message: string): void {
    this.sessionLifecycle.setLastAiMessage(sessionId, message)
  }

  pushTerminalMessage(sessionId: string, data: string): void {
    const session = this.getSession(sessionId)
    const activeTab = session?.tabs.find(t => t.id === session.activeTabId)
    const terminalId = isTerminalLikeTab(activeTab) ? activeTab.terminalId : session?.tabs.find(isTerminalLikeTab)?.terminalId
    if (terminalId) {
      this.broadcast({ event: 'terminal:data', payload: { sessionId, terminalId, data } })
    }
  }

  archiveSession(sessionId: string): void {
    this.sessionLifecycle.archiveSession(sessionId)
  }

  restoreSession(sessionId: string): void {
    this.sessionLifecycle.restoreSession(sessionId)
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionLifecycle.deleteSession(sessionId)
  }

  async getGitLog(sessionId: string, limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return { commits: [], branches: [], head: '' }
    return this.worktreeService.getGitLog(session.worktreePath, limit, offset, branch)
  }

  async getGitBranches(sessionId: string): Promise<GitBranch[]> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return []
    return this.worktreeService.getGitBranches(session.worktreePath)
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return this.worktreeService.getRepoBranches()
  }

  async commitAll(sessionId: string, message: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.commitAll(sessionId, message, session.worktreePath)
    const log = await this.worktreeService.getGitLog(session.worktreePath, 100, 0)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
    this.refreshDiff(sessionId)
  }

  async commitFiles(sessionId: string, message: string, filePaths: string[]): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.commitFiles(sessionId, message, filePaths, session.worktreePath)
    const log = await this.worktreeService.getGitLog(session.worktreePath, 100, 0)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
    this.refreshDiff(sessionId)
  }

  async discardAll(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.discardAll(sessionId, session.worktreePath)
    this.refreshDiff(sessionId)
  }

  async discardFile(sessionId: string, filePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.discardFile(sessionId, filePath, session.worktreePath)
    this.refreshDiff(sessionId)
  }

  async checkoutBranch(sessionId: string, branch: string, createNew = false): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.checkoutBranch(sessionId, branch, createNew, session.worktreePath)
    if (session.isMain) {
      this.sessionRepository.updateBranch(sessionId, branch)
      const updated = this.getSession(sessionId)
      if (updated) {
        this.broadcast({ event: 'session:updated', payload: updated })
      }
    }
    this.refreshDiff(sessionId)
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
    await this.worktreeService.mergeIntoCurrentBranch(mainSession.worktreePath, branchToMerge, 'merge')
    const log = await this.worktreeService.getGitLog(mainSession.worktreePath, 100, 0)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId: mainSession.id, ...log } })
    this.refreshDiff(mainSession.id)
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
    await this.worktreeService.updateFromBase(sessionId, mainSession.branchName, session.worktreePath)
    const log = await this.worktreeService.getGitLog(session.worktreePath, 100, 0)
    this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
    this.refreshDiff(sessionId)
  }

  async getFileDiffContent(sessionId: string, filePath: string): Promise<{ original: string; modified: string }> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeService.getFileDiffContent(session.worktreePath, filePath)
  }

  async getFileDiffLines(sessionId: string, filePath: string): Promise<import('@akari/shared-types').FileDiffLine[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeService.getFileDiffLines(session.worktreePath, filePath)
  }

  async getFileDiffHunks(sessionId: string, filePath: string): Promise<import('@akari/shared-types').DiffHunk[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeService.getFileDiffHunks(session.worktreePath, filePath)
  }

  async getAllDiffHunks(sessionId: string): Promise<Record<string, import('@akari/shared-types').DiffHunk[]>> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return {}
    return this.worktreeService.getAllDiffHunks(session.worktreePath)
  }

  async listFiles(sessionId: string, relativePath: string): Promise<FileNode[]> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.fileService.listFiles(session.worktreePath, relativePath)
  }

  async readFileContent(sessionId: string, filePath: string): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.fileService.readFileContent(session.worktreePath, filePath)
  }

  async writeFileContent(sessionId: string, filePath: string, content: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.fileService.writeFileContent(session.worktreePath, filePath, content)
  }

  async restoreSessions(): Promise<void> {
    return this.sessionLifecycle.restoreSessions()
  }

  refreshDiff(sessionId: string): void {
    this.sessionLifecycle.refreshDiff(sessionId)
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
