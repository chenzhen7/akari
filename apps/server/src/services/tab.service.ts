import path from 'node:path'
import { nanoid } from 'nanoid'
import type { AgentSession, AgentType, ServerMessage, SessionTab } from '@akari/shared-types'
import { createAgentAdapter } from '../agent-adapters/index.js'
import type { AgentLaunchOptions } from '../agent-adapters/base.js'
import { SessionRepository } from '../infrastructure/db/repositories/session.repository.js'
import { ITerminalService } from './terminal.service.js'
import { isTerminalLikeTab } from './tab-utils.js'
import { launchAgentInTerminal } from './agent-launcher.js'

export interface ITabService {
  createTab(sessionId: string, type: 'terminal' | 'agent' | 'diff' | 'file' | 'review', filePath?: string, agentType?: AgentType, launchOptions?: AgentLaunchOptions): SessionTab
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
    type: 'terminal' | 'agent' | 'diff' | 'file' | 'review',
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
    } else if (type === 'review') {
      label = '审查'
    } else {
      label = filePath ? path.basename(filePath) : (type === 'file' ? 'File' : 'Diff')
    }

    const tab: SessionTab = { id: tabId, type: resolvedType, label, filePath, terminalId, agentType }
    let updatedTabs = [...session.tabs, tab]
    const activeTabId = tabId

    const evictedTabIds: string[] = []
    if (resolvedType === 'file' || resolvedType === 'diff' || resolvedType === 'review') {
      const isDocTab = (t: SessionTab): boolean => t.type === 'file' || t.type === 'diff' || t.type === 'review'
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
        launchAgentInTerminal(this.terminalService, terminalId, session.worktreePath, agentType, session.task, sessionId, launchOptions).catch(err => {
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

    if (isTerminalLikeTab(tab) && tab.terminalId) {
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

    const tab = session.tabs.find(t => t.id === tabId)!
    // 懒恢复：未恢复 PTY 的终端标签在首次激活时才创建终端
    if (isTerminalLikeTab(tab) && !tab.terminalId && session.worktreePath) {
      const terminalId = nanoid(8)
      this.terminalService.createTerminal(terminalId, sessionId, session.worktreePath)
      const updatedTab = { ...tab, terminalId }
      const updatedTabs = session.tabs.map(t => (t.id === tabId ? updatedTab : t))
      this.sessionRepository.updateTerminalIdAndTabs(sessionId, updatedTabs, tabId, terminalId)
      this.broadcast({ event: 'tabs:sync', payload: { sessionId, tabs: updatedTabs, activeTabId: tabId } })
      this.broadcast({ event: 'tab:activated', payload: { sessionId, tabId } })
      return
    }

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
}
