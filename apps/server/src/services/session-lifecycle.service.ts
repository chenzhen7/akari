import { access } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import type { AgentSession, AgentType, GitDiff, GitLogResponse, ServerMessage, SessionStatus, SessionTab } from '@akari/shared-types'
import { createAgentAdapter } from '../agent-adapters/index.js'
import { createAgentSession, createMainSession } from '../core/session-factory.js'
import { STATUS_TO_KANBAN, validateTransition } from '../core/session-state-machine.js'
import { SessionRepository } from '../infrastructure/db/repositories/session.repository.js'
import { SettingsStore } from '../infrastructure/db/settings-store.js'
import { launchAgentInTerminal } from './agent-launcher.js'
import { ITabService } from './tab.service.js'
import { ITerminalService } from './terminal.service.js'
import { IWorktreeService } from './worktree.service.js'
import { isTerminalLikeTab } from './tab-utils.js'
import { perfLog, perfNow } from '../perf-log.js'

export interface CreateSessionParams {
  name: string
  task: string
  baseBranch?: string
  agentType?: AgentType
  tags?: string[]
  canvasPosition?: { x: number; y: number }
  parentSessionId?: string
}

export interface ISessionLifecycleService {
  createSession(params: CreateSessionParams): Promise<AgentSession>
  updateStatus(sessionId: string, status: SessionStatus): void
  archiveSession(sessionId: string): void
  restoreSession(sessionId: string): void
  deleteSession(sessionId: string): Promise<void>
  getSession(sessionId: string): AgentSession | null
  getMainSession(): AgentSession | null
  ensureMainSession(workspacePath: string): Promise<AgentSession>
  listSessions(): AgentSession[]
  restoreSessions(): Promise<void>
  setLastAiMessage(sessionId: string, message: string): void
  updateCanvasPosition(sessionId: string, x: number, y: number): void
  refreshDiff(sessionId: string): void
  broadcastMessage(msg: ServerMessage): void
  getSettings(): { worktreeBaseDir: string }
  updateSettings(settings: { worktreeBaseDir: string }): void
  setWorkspace(workspaceId: string, workspacePath: string, repoRoot: string, isGitWorkspace?: boolean): void
}

export class SessionLifecycleService implements ISessionLifecycleService {
  private workspaceId: string
  private repoRoot: string
  private workspacePath: string
  private isGitWorkspace: boolean

  constructor(
    opts: {
      workspaceId: string
      repoRoot: string
      workspacePath: string
      isGitWorkspace?: boolean
    },
    private readonly sessionRepository: SessionRepository,
    private readonly settingsStore: SettingsStore,
    private readonly worktreeService: IWorktreeService,
    private readonly tabService: ITabService,
    private readonly terminalService: ITerminalService,
    private readonly broadcast: (msg: ServerMessage) => void,
  ) {
    this.workspaceId = opts.workspaceId
    this.repoRoot = opts.repoRoot
    this.workspacePath = opts.workspacePath
    this.isGitWorkspace = opts.isGitWorkspace ?? true
  }

  setWorkspace(workspaceId: string, workspacePath: string, repoRoot: string, isGitWorkspace = true): void {
    this.workspaceId = workspaceId
    this.workspacePath = workspacePath
    this.repoRoot = repoRoot
    this.isGitWorkspace = isGitWorkspace
  }

  getSession(sessionId: string): AgentSession | null {
    return this.sessionRepository.getById(sessionId)
  }

  getMainSession(): AgentSession | null {
    return this.sessionRepository.getMainByWorkspaceId(this.workspaceId)
  }

  listSessions(): AgentSession[] {
    return this.sessionRepository.listByWorkspaceId(this.workspaceId)
  }

  updateCanvasPosition(sessionId: string, x: number, y: number): void {
    this.sessionRepository.updateCanvasPosition(sessionId, x, y)
  }

  setLastAiMessage(sessionId: string, message: string): void {
    this.sessionRepository.updateLastAiMessage(sessionId, message)
  }

  broadcastMessage(msg: ServerMessage): void {
    this.broadcast(msg)
  }

  getSettings(): { worktreeBaseDir: string } {
    return { worktreeBaseDir: this.settingsStore.getWorktreeBaseDir() }
  }

  updateSettings(settings: { worktreeBaseDir: string }): void {
    this.settingsStore.setWorktreeBaseDir(settings.worktreeBaseDir)
  }

  async createSession(params: CreateSessionParams): Promise<AgentSession> {
    if (!this.isGitWorkspace) {
      throw new Error('当前工作区不是 Git 仓库，无法创建 Agent 会话')
    }

    const mainSession = this.getMainSession()
    const baseBranch = params.baseBranch ?? mainSession?.branchName ?? 'main'
    const agentType = params.agentType ?? 'claude'

    const session = createAgentSession({
      name: params.name,
      task: params.task,
      agentType,
      baseBranch,
      workspaceId: this.workspaceId,
      canvasPosition: params.canvasPosition,
      parentSessionId: params.parentSessionId,
      tags: params.tags,
    })

    this.sessionRepository.create(session)
    this.broadcast({ event: 'session:created', payload: session })

    this.initSession(session).catch(err => {
      console.error(`[SessionLifecycleService] init failed for ${session.id}:`, err)
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
  }

  async ensureMainSession(workspacePath: string): Promise<AgentSession> {
    const existing = this.getMainSession()
    if (existing) {
      if (this.isGitWorkspace) {
        this.watchMainBranch(existing.id, this.repoRoot)
        const currentBranch = await this.worktreeService.getCurrentBranch()
        if (currentBranch !== existing.branchName) {
          this.sessionRepository.updateBranchAndBase(existing.id, currentBranch, currentBranch)
          const updated = this.getSession(existing.id)
          if (updated) {
            this.broadcast({ event: 'session:updated', payload: updated })
          }
        }
      } else {
        const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? '主工作区'
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

    const currentBranch = this.isGitWorkspace ? await this.worktreeService.getCurrentBranch() : ''
    const session = createMainSession(workspacePath, this.workspaceId, currentBranch)
    this.sessionRepository.create(session)
    this.broadcast({ event: 'session:created', payload: session })

    if (this.isGitWorkspace) {
      this.worktreeService.watchDiff(
        session.id,
        this.createDiffCallbacks(session.id, session.worktreePath),
        session.worktreePath,
      )
      this.watchMainBranch(session.id, this.repoRoot)
    }

    return session
  }

  archiveSession(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (session?.isMain) {
      throw new Error('Cannot archive the main session')
    }
    if (session) {
      for (const tab of session.tabs) {
        if (isTerminalLikeTab(tab) && tab.terminalId) {
          this.terminalService.killTerminal(tab.terminalId)
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
      if (isTerminalLikeTab(tab) && tab.terminalId) {
        this.terminalService.killTerminal(tab.terminalId)
      }
    }
    await this.worktreeService.removeWorktree(sessionId, session.worktreePath, session.branchName).catch(err => {
      console.warn(`[SessionLifecycleService] removeWorktree failed for ${sessionId} during delete (non-fatal):`, err)
    })
    this.sessionRepository.delete(sessionId)
  }

  async restoreSessions(): Promise<void> {
    const tRestore = perfNow()
    const sessions = this.listSessions()
    console.log(`[Perf] [restoreSessions] 开始恢复 ${sessions.length} 个会话`)

    for (const session of sessions) {
      const tSession = perfNow()
      if (session.isMain) {
        if (session.worktreePath && this.isGitWorkspace) {
          this.worktreeService.watchDiff(
            session.id,
            this.createDiffCallbacks(session.id, session.worktreePath),
            session.worktreePath,
          )
        }
      }

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

      let tabs = session.tabs
      let activeTabId = session.activeTabId
      if (tabs.length === 0) {
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
        this.terminalService.createTerminal(terminalId, session.id, session.worktreePath)
      } else {
        const restoredTabs: SessionTab[] = []
        for (const tab of tabs) {
          if (isTerminalLikeTab(tab)) {
            const terminalId = nanoid(8)
            this.terminalService.createTerminal(terminalId, session.id, session.worktreePath)
            restoredTabs.push({ ...tab, terminalId })
          } else {
            restoredTabs.push(tab)
          }
        }
        tabs = restoredTabs
        if (activeTabId && !tabs.find(t => t.id === activeTabId)) {
          activeTabId = tabs.length > 0 ? tabs[0].id : null
        }
      }

      const terminalId = this.resolveSessionTerminalId(tabs, activeTabId)
      this.sessionRepository.updateTerminalIdAndTabs(session.id, tabs, activeTabId, terminalId ?? '')
      this.broadcast({ event: 'tabs:sync', payload: { sessionId: session.id, tabs, activeTabId } })

      const displayTerminalId = terminalId
      if (displayTerminalId) {
        this.terminalService.sendToTerminal(displayTerminalId, `\r\n\x1b[33m> [Server restarted — terminal restored]\x1b[0m\r\n`)
      }

      if (!session.isMain && session.worktreePath) {
        this.worktreeService.watchDiff(session.id, this.createDiffCallbacks(session.id))
      }

      perfLog(`[restoreSessions] 会话 ${session.id}（isMain=${session.isMain}）恢复完成`, tSession)
    }

    perfLog(`[restoreSessions] 全部 ${sessions.length} 个会话恢复完成（总耗时）`, tRestore)
  }

  refreshDiff(sessionId: string): void {
    this.broadcastDiffUpdate(sessionId)
  }

  private clearSessionTerminalIds(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (!session) return

    let changed = false
    const clearedTabs = session.tabs.map(tab => {
      if (isTerminalLikeTab(tab) && tab.terminalId) {
        this.terminalService.killTerminal(tab.terminalId)
        changed = true
        return { ...tab, terminalId: undefined }
      }
      return tab
    })

    if (!changed && !session.terminalId) return

    this.sessionRepository.updateTabsAndTerminalId(sessionId, clearedTabs, '')
    this.broadcast({ event: 'tabs:sync', payload: { sessionId, tabs: clearedTabs, activeTabId: session.activeTabId } })
  }

  private resolveSessionTerminalId(tabs: SessionTab[], activeTabId: string | null): string | undefined {
    const activeTab = tabs.find(t => t.id === activeTabId)
    if (isTerminalLikeTab(activeTab) && activeTab.terminalId) {
      return activeTab.terminalId
    }
    return tabs.find(t => isTerminalLikeTab(t) && t.terminalId)?.terminalId
  }

  private async initSession(session: AgentSession): Promise<void> {
    const { id, baseBranch } = session
    try {
      this.pushTerminalDisplay(id, '> Creating git worktree...\r\n')

      const { branchName, worktreePath, resolvedBase } = await this.worktreeService.createWorktree(id, baseBranch)

      session.worktreePath = worktreePath
      session.branchName = branchName
      session.baseBranch = resolvedBase

      this.sessionRepository.updateWorktreeAndBranch(id, worktreePath, branchName, resolvedBase)
      this.broadcast({ event: 'session:updated', payload: session })

      this.pushTerminalDisplay(id, `> Branch: ${branchName}\r\n`)
      this.pushTerminalDisplay(id, `> Worktree: ${worktreePath}\r\n`)

      const terminalId = nanoid(8)
      this.terminalService.createTerminal(terminalId, id, worktreePath)

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

      await launchAgentInTerminal(this.terminalService, terminalId, worktreePath, session.agentType, session.task, id)

      this.worktreeService.watchDiff(id, this.createDiffCallbacks(id))
      this.updateStatus(id, 'idle')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.pushTerminalDisplay(id, `> ❌ Init failed: ${msg}\r\n`)
      const current = this.getSession(id)
      if (current && validateTransition(current.status, 'failed')) {
        this.updateStatus(id, 'failed')
      }
    }
  }

  private pushTerminalDisplay(sessionId: string, data: string): void {
    const session = this.getSession(sessionId)
    const activeTab = session?.tabs.find(t => t.id === session.activeTabId)
    const terminalId = isTerminalLikeTab(activeTab) ? activeTab.terminalId : session?.tabs.find(isTerminalLikeTab)?.terminalId
    if (terminalId) {
      this.broadcast({ event: 'terminal:data', payload: { sessionId, terminalId, data } })
    }
  }

  private broadcastDiffUpdate(sessionId: string): void {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) return
    void this.worktreeService.getCurrentDiff(session.worktreePath).then(diff => {
      this.sessionRepository.updateDiffSummary(sessionId, diff.summary)
      this.broadcast({ event: 'diff:update', payload: { sessionId, diff } })
    }).catch((err: unknown) => {
      console.warn(`[SessionLifecycleService] failed to broadcast diff update for ${sessionId}:`, err)
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
        const targetCwd = cwd ?? this.getSession(sessionId)?.worktreePath
        if (targetCwd) {
          this.worktreeService.getGitLog(targetCwd, 100, 0).then((log: GitLogResponse) => {
            this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
          }).catch((err: unknown) => {
            console.warn(`[SessionLifecycleService] git log failure after diff update for ${sessionId}:`, err)
          })
        }
      },
      onFileChange: (filePath: string, changeType: 'add' | 'change' | 'unlink') => {
        this.broadcast({ event: 'file:update', payload: { sessionId, filePath, changeType } })
      },
    }
  }

  private watchMainBranch(sessionId: string, repoRoot: string): void {
    this.worktreeService.watchGitMetadata(sessionId, repoRoot, () => {
      void (async () => {
        const session = this.getSession(sessionId)
        if (!session || !session.isMain) return
        const branch = await this.worktreeService.getCurrentBranch(repoRoot)
        if (branch !== session.branchName) {
          this.sessionRepository.updateBranchAndBase(sessionId, branch, branch)
          const updated = this.getSession(sessionId)
          if (updated) {
            this.broadcast({ event: 'session:updated', payload: updated })
          }
        }
        this.refreshDiff(sessionId)
      })()
    })
  }
}
