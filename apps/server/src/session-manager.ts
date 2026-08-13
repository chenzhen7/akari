import Database from 'better-sqlite3'
import type { AgentSession, AgentType, FileNode, GitBranch, GitDiff, GitLogResponse, ServerMessage, SessionStatus, SessionTab } from '@akari/shared-types'
import { GitCommandRunner, GitError } from './infrastructure/git/git-command-runner.js'
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

/**
 * OSC 标题防抖窗口。Claude Code 的标题带 spinner（`⠐ Claude Code`）每帧变化，
 * 直接应用会导致 tab 闪烁 + DB 写放大；只有标题稳定该时长后才应用。
 */
const TITLE_DEBOUNCE_MS = 250

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

  /** terminalId → 待应用的 OSC 标题（trailing debounce，避免 spinner 标题闪烁 + DB 写放大） */
  private readonly titleDebounce = new Map<string, { timer: ReturnType<typeof setTimeout>; pendingTitle: string }>()

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

    for (const { timer } of this.titleDebounce.values()) clearTimeout(timer)
    this.titleDebounce.clear()

    await this.worktreeService.dispose().catch((err: unknown) => {
      console.error(`[SessionManager] worktreeService.dispose failed:`, err)
    })

    this.terminalService.dispose()
    this.sessionLifecycle.dispose()
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

  /** git init / 外部初始化后把工作区升级为 git 工作区（幂等）。 */
  async enableGitWorkspace(repoRoot: string): Promise<void> {
    this.guardDisposed()
    await this.sessionLifecycle.enableGitWorkspace(repoRoot)
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
    commitHash?: string,
  ): SessionTab {
    this.guardDisposed()
    return this.tabService.createTab(sessionId, type, filePath, agentType, launchOptions, commitHash)
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
      return { files: [], summary: { additions: 0, deletions: 0, files: 0 } }
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

  async getCommitFiles(sessionId: string, hash: string): Promise<GitDiff['files']> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return []
    return this.worktreeService.getCommitFiles(session.worktreePath, hash)
  }

  async getCommitFileDiff(sessionId: string, hash: string, filePath: string): Promise<{ original: string; modified: string }> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return { original: '', modified: '' }
    return this.worktreeService.getCommitFileDiff(session.worktreePath, hash, filePath)
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return this.worktreeService.getRepoBranches()
  }

  async commitAll(sessionId: string, message: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.commitAll(sessionId, message, session.worktreePath)
    // 快速返回：git 写命令结束后后台异步刷新（列表 + 图），不阻塞前端按钮
    this.sessionLifecycle.scheduleGitRefresh(sessionId, true)
  }

  async commitFiles(sessionId: string, message: string, filePaths: string[]): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.commitFiles(sessionId, message, filePaths, session.worktreePath)
    this.sessionLifecycle.scheduleGitRefresh(sessionId, true)
  }

  async discardAll(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.discardAll(sessionId, session.worktreePath)
    // 只刷变更列表，HEAD 未动图不刷
    this.sessionLifecycle.scheduleGitRefresh(sessionId, false)
  }

  async discardFile(sessionId: string, filePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.discardFile(sessionId, filePath, session.worktreePath)
    this.sessionLifecycle.scheduleGitRefresh(sessionId, false)
  }

  async revertChange(sessionId: string, filePath: string, line: number): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.worktreeService.revertChange(sessionId, filePath, line, session.worktreePath)
    // 只刷变更列表，HEAD 未动图不刷
    this.sessionLifecycle.scheduleGitRefresh(sessionId, false)
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
    this.sessionLifecycle.scheduleGitRefresh(sessionId, true)
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
    this.sessionLifecycle.scheduleGitRefresh(mainSession.id, true)
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
    this.sessionLifecycle.scheduleGitRefresh(sessionId, true)
  }

  async pullMain(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (!session.isMain) {
      throw new Error('pull is only available for the main session')
    }
    try {
      await this.worktreeService.pullMain(session.worktreePath)
    } catch (err) {
      this.rethrowRemoteError(err)
    }
    this.sessionLifecycle.scheduleGitRefresh(sessionId, true)
  }

  async pushMain(sessionId: string): Promise<{ upToDate: boolean }> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (!session.isMain) {
      throw new Error('push is only available for the main session')
    }
    let result: { upToDate: boolean }
    try {
      result = await this.worktreeService.pushMain(session.worktreePath)
    } catch (err) {
      this.rethrowRemoteError(err)
    }
    this.sessionLifecycle.scheduleGitRefresh(sessionId, true)
    return result
  }

  /** 远程相关错误给出可操作的中文提示，其余错误原样抛出 */
  private rethrowRemoteError(err: unknown): never {
    if (err instanceof GitError && err.code === 'NO_REMOTE') {
      throw new Error('未配置远程仓库（origin），请先在终端执行 git remote add origin <仓库地址>')
    }
    if (err instanceof GitError && err.code === 'NO_UPSTREAM') {
      throw new Error('当前分支还没有上游，请先点击「推送」把分支推送到远程')
    }
    throw err
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

  /** 二进制读取（markdown 预览相对图片等），供 raw-file 路由使用 */
  async readRawFile(sessionId: string, filePath: string): Promise<Buffer> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.fileService.readRawFile(session.worktreePath, filePath)
  }

  async writeFileContent(sessionId: string, filePath: string, content: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.fileService.writeFileContent(session.worktreePath, filePath, content)
  }

  async createDirectory(sessionId: string, dirPath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.fileService.createDirectory(session.worktreePath, dirPath)
  }

  async createFile(sessionId: string, filePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.fileService.createFile(session.worktreePath, filePath)
  }

  async renamePath(sessionId: string, fromPath: string, toPath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.fileService.renamePath(session.worktreePath, fromPath, toPath)
  }

  async deletePath(sessionId: string, targetPath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    await this.fileService.deletePath(session.worktreePath, targetPath)
  }

  async copyPath(sessionId: string, source: string, targetDir: string): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.fileService.copyPath(session.worktreePath, source, targetDir)
  }

  async movePath(sessionId: string, source: string, targetDir: string): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.fileService.movePath(session.worktreePath, source, targetDir)
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
      'terminal:title',
      ({ sessionId, terminalId, title }: { sessionId: string; terminalId: string; title: string }) => {
        this.updateTabTitleFromShell(sessionId, terminalId, title)
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

  /** OSC 标题防抖入口：标题稳定 TITLE_DEBOUNCE_MS 后才持久化并广播。 */
  private updateTabTitleFromShell(sessionId: string, terminalId: string, title: string): void {
    const existing = this.titleDebounce.get(terminalId)
    if (existing?.pendingTitle === title) return
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      this.titleDebounce.delete(terminalId)
      this.applyTabTitleFromShell(sessionId, terminalId, title)
    }, TITLE_DEBOUNCE_MS)
    this.titleDebounce.set(terminalId, { timer, pendingTitle: title })
  }

  /** 把解析到的 shell/TUI 标题应用到对应 tab（仅 terminal/agent），持久化并广播。 */
  private applyTabTitleFromShell(sessionId: string, terminalId: string, title: string): void {
    const session = this.getSession(sessionId)
    if (!session) return

    let targetTab: SessionTab | undefined
    const updatedTabs = session.tabs.map(tab => {
      if (isTerminalLikeTab(tab) && tab.terminalId === terminalId && tab.titleFromShell !== title) {
        targetTab = { ...tab, titleFromShell: title }
        return targetTab
      }
      return tab
    })
    if (!targetTab) return

    this.sessionRepository.updateTabs(sessionId, updatedTabs)
    this.broadcast({ event: 'tab:title', payload: { sessionId, tabId: targetTab.id, title } })
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
