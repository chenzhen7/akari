import { create } from 'zustand'
import { sendWsMessage } from '@/features/terminal/stores/connection-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { findSession } from '@/features/session/stores/session-store'

interface TabStore {
  createTab: (sessionId: string, type: 'terminal' | 'agent' | 'diff' | 'file', filePath?: string) => void
  closeTab: (sessionId: string, tabId: string) => void
  activateTab: (sessionId: string, tabId: string) => void
  reorderTabs: (sessionId: string, orderedTabIds: string[]) => void
}

export const useTabStore = create<TabStore>(() => ({
  createTab: (sessionId, type, filePath) => {
    sendWsMessage('tab:create', { sessionId, type, filePath })
  },

  closeTab: (sessionId, tabId) => {
    sendWsMessage('tab:close', { sessionId, tabId })
  },

  activateTab: (sessionId, tabId) => {
    const ws = useWorkspaceStore.getState()
    const session = findSession(ws.workspaceSessions, sessionId)
    // 幂等性检查：tab 已不存在则跳过（如已关闭），防止把 activeTabId 写回已删除的 tab
    if (!session?.tabs.some(tab => tab.id === tabId)) return
    ws.updateSession(sessionId, { activeTabId: tabId })

    sendWsMessage('tab:activate', { sessionId, tabId })
  },

  reorderTabs: (sessionId, orderedTabIds) => {
    const ws = useWorkspaceStore.getState()
    const session = findSession(ws.workspaceSessions, sessionId)
    if (!session) return
    // Optimistically update local order so the UI doesn't flash on drag end.
    const tabMap = new Map(session.tabs.map(t => [t.id, t]))
    const reordered = orderedTabIds.map(id => tabMap.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
    ws.updateSession(sessionId, { tabs: reordered })

    sendWsMessage('tab:reorder', { sessionId, orderedTabIds })
  },
}))
