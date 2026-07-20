import { create } from 'zustand'
import { sendWsMessage } from './connection-store'
import { useSessionStore } from './session-store'

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
    useSessionStore.setState(state => ({
      sessions: state.sessions.map(s => {
        if (s.id !== sessionId || !s.tabs.some(tab => tab.id === tabId)) return s
        return { ...s, activeTabId: tabId }
      }),
    }))

    sendWsMessage('tab:activate', { sessionId, tabId })
  },

  reorderTabs: (sessionId, orderedTabIds) => {
    // Optimistically update local order so the UI doesn't flash on drag end.
    useSessionStore.setState(state => ({
      sessions: state.sessions.map(s => {
        if (s.id !== sessionId) return s
        const tabMap = new Map(s.tabs.map(t => [t.id, t]))
        const reordered = orderedTabIds.map(id => tabMap.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
        return { ...s, tabs: reordered }
      }),
    }))

    sendWsMessage('tab:reorder', { sessionId, orderedTabIds })
  },
}))
