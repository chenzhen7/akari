import type { AgentSession, ServerMessage } from '@akari/shared-types'
import { terminalBus } from '@/lib/terminalBus'
import { fileUpdateBus } from '@/lib/fileUpdateBus'
import { useSessionStore } from './session-store'
import { useConnectionStore } from './connection-store'
import { useWorkspaceStore } from './workspace-store'

export function handleServerMessage(msg: ServerMessage): void {
  switch (msg.event) {
    case 'sessions:list':
      useSessionStore.setState(state => {
        let nextActiveSessionId = state.activeSessionId
        // 如果当前没有选中会话或选中的已不存在，自动选中第一个
        if (!nextActiveSessionId || !msg.payload.some((s: AgentSession) => s.id === nextActiveSessionId)) {
          nextActiveSessionId = msg.payload.length > 0 ? msg.payload[0].id : null
        }
        return { sessions: msg.payload, activeSessionId: nextActiveSessionId }
      })
      break
    case 'session:created':
      useSessionStore.setState(state => ({
        sessions: [...state.sessions.filter(s => s.id !== msg.payload.id), msg.payload],
      }))
      break
    case 'session:updated':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s => s.id === msg.payload.id ? msg.payload : s),
      }))
      break
    case 'session:status':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.id
            ? { ...s, status: msg.payload.status, progress: msg.payload.progress }
            : s
        ),
      }))
      break
    case 'terminal:data':
      terminalBus.emit(msg.payload.terminalId, msg.payload.data)
      break
    case 'terminal:ready':
      useConnectionStore.setState(state => ({
        terminalReadyTick: {
          ...state.terminalReadyTick,
          [msg.payload.terminalId]: (state.terminalReadyTick[msg.payload.terminalId] ?? 0) + 1,
        },
      }))
      break
    case 'terminal:resized':
      terminalBus.resized(msg.payload.terminalId)
      break
    case 'diff:update':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.sessionId
            ? {
              ...s,
              diffSummary: msg.payload.diff.summary,
              diffFull: msg.payload.diff.fullDiff,
              diffFiles: msg.payload.diff.files,
            }
            : s
        ),
      }))
      break
    case 'file:update': {
      const { sessionId } = msg.payload
      fileUpdateBus.emit(sessionId, msg.payload)
      break
    }
    case 'git:log-updated': {
      const { sessionId, commits, branches, head } = msg.payload
      useSessionStore.setState(state => ({
        gitLogs: { ...state.gitLogs, [sessionId]: { commits, branches, head } },
      }))
      break
    }
    case 'canvas:edges':
      useSessionStore.setState({ canvasEdges: msg.payload })
      break
    case 'session:lastMessage':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.id ? { ...s, lastAiMessage: msg.payload.lastAiMessage } : s
        ),
      }))
      break
    case 'tab:created':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.sessionId
            ? { ...s, tabs: [...s.tabs, msg.payload.tab] }
            : s
        ),
      }))
      break
    case 'tab:closed':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s => {
          if (s.id !== msg.payload.sessionId) return s
          const updatedTabs = s.tabs.filter(t => t.id !== msg.payload.tabId)
          let activeTabId = s.activeTabId
          if (activeTabId === msg.payload.tabId) {
            activeTabId = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null
          }
          return { ...s, tabs: updatedTabs, activeTabId }
        }),
      }))
      break
    case 'tab:activated':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.sessionId
            ? { ...s, activeTabId: msg.payload.tabId }
            : s
        ),
      }))
      break
    case 'tabs:sync':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.sessionId
            ? { ...s, tabs: msg.payload.tabs, activeTabId: msg.payload.activeTabId }
            : s
        ),
      }))
      break
    case 'workspace:current':
      useWorkspaceStore.getState().setCurrentWorkspace(msg.payload)
      useSessionStore.getState().resetForWorkspace()
      break
    case 'workspace:list':
      useWorkspaceStore.setState({ workspaces: msg.payload })
      break
  }
}
