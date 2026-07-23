import path from 'node:path'
import { nanoid } from 'nanoid'
import type { AgentSession, AgentType, ServerMessage, SessionTab } from '@akari/shared-types'
import { createAgentAdapter, SHELL_STARTUP_DELAY_MS } from '../agent-adapters/index.js'
import type { AgentLaunchOptions } from '../agent-adapters/base.js'
import { SessionRepository } from '../infrastructure/db/repositories/session.repository.js'
import { ITerminalService } from './terminal.service.js'

export interface ITabService {
  createTab(sessionId: string, type: 'terminal' | 'agent' | 'diff' | 'file', filePath?: string, agentType?: AgentType, launchOptions?: AgentLaunchOptions): SessionTab
  closeTab(sessionId: string, tabId: string): void
  activateTab(sessionId: string, tabId: string): void
  reorderTabs(sessionId: string, orderedTabIds: string[]): void
  getTabs(sessionId: string): SessionTab[]
}

export class TabService implements ITabService {
  private static readonly MAX_DOC_TABS = 10

  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly terminalService: ITerminalService,
    private readonly broadcast: (msg: ServerMessage) => void,
  ) {}

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

    const evictedTabIds: string[] = []
    if (resolvedType === 'file' || resolvedType === 'diff') {
      const isDocTab = (t: SessionTab): boolean => t.type === 'file' || t.type === 'diff'
      let docCount = updatedTabs.filter(isDocTab).length
      while (docCount > TabService.MAX_DOC_TABS) {
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
      this.terminalService.createTerminal(terminalId, sessionId, session.worktreePath)
      if (agentType) {
        this.launchAgentInTab(sessionId, terminalId, session.worktreePath, agentType, session.task, launchOptions).catch(err => {
          console.error(`[TabService] launchAgentInTab failed for ${sessionId}:`, err)
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
      this.terminalService.killTerminal(tab.terminalId)
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

  private getSession(sessionId: string): AgentSession | null {
    return this.sessionRepository.getById(sessionId)
  }

  private async launchAgentInTab(
    sessionId: string,
    terminalId: string,
    worktreePath: string,
    agentType: AgentType,
    task: string,
    launchOptions?: AgentLaunchOptions,
  ): Promise<void> {
    const adapter = createAgentAdapter(agentType)
    if (!adapter.isAutomated) return

    const display = `> Launching ${agentType}...\r\n`
    this.terminalService.sendToTerminal(terminalId, display)

    const commands = await adapter.prepare(worktreePath, task, sessionId, launchOptions)
    let cumulativeDelay = SHELL_STARTUP_DELAY_MS
    for (const { cmd, delayMs = 0 } of commands) {
      cumulativeDelay += delayMs
      setTimeout(() => {
        if (this.terminalService.hasTerminal(terminalId)) {
          this.terminalService.sendToTerminal(terminalId, cmd)
        }
      }, cumulativeDelay)
    }
  }
}
