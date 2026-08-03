import type { AgentSession, ServerMessage } from '@akari/shared-types'
import { terminalBus } from '@/features/terminal/lib/terminalBus'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'
import { useSessionStore } from '@/features/session/stores/session-store'
import { useConnectionStore } from '@/features/terminal/stores/connection-store'
import { useWorkspaceStore, mergeWorkspaces } from '@/features/workspace/stores/workspace-store'

export function handleServerMessage(msg: ServerMessage): void {
  switch (msg.event) {
    case 'sessions:list': {
      const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspace?.id
      useSessionStore.setState(state => {
        let nextActiveSessionId = state.activeSessionId
        // 如果当前没有选中会话或选中的已不存在，自动选中第一个
        if (!nextActiveSessionId || !msg.payload.some((s: AgentSession) => s.id === nextActiveSessionId)) {
          nextActiveSessionId = msg.payload.length > 0 ? msg.payload[0].id : null
        }
        return { sessions: msg.payload, activeSessionId: nextActiveSessionId }
      })
      if (currentWorkspaceId) {
        useWorkspaceStore.setState(state => ({
          workspaceSessions: { ...state.workspaceSessions, [currentWorkspaceId]: msg.payload },
        }))
      }
      break
    }
    case 'session:created':
      useSessionStore.setState(state => ({
        sessions: [...state.sessions.filter(s => s.id !== msg.payload.id), msg.payload],
      }))
      useWorkspaceStore.getState().addSession(msg.payload)
      break
    case 'session:updated':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s => s.id === msg.payload.id ? msg.payload : s),
      }))
      useWorkspaceStore.getState().updateSession(msg.payload.id, msg.payload)
      break
    case 'session:status':
      useSessionStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === msg.payload.id
            ? { ...s, status: msg.payload.status, progress: msg.payload.progress, kanbanColumn: msg.payload.kanbanColumn }
            : s
        ),
      }))
      useWorkspaceStore.getState().updateSession(msg.payload.id, {
        status: msg.payload.status,
        progress: msg.payload.progress,
        kanbanColumn: msg.payload.kanbanColumn,
      })
      break
    case 'session:deleted':
      useSessionStore.setState(state => ({
        sessions: state.sessions.filter(s => s.id !== msg.payload.id),
      }))
      useWorkspaceStore.getState().removeSession(msg.payload.id)
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
      useWorkspaceStore.getState().updateSession(msg.payload.sessionId, {
        diffSummary: msg.payload.diff.summary,
        diffFull: msg.payload.diff.fullDiff,
        diffFiles: msg.payload.diff.files,
      })
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
      useWorkspaceStore.getState().updateSession(msg.payload.id, {
        lastAiMessage: msg.payload.lastAiMessage,
      })
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
    case 'workspace:activated':
      // 仅代表「某项目被显式激活/切换」。桌面端每个窗口只会收到自己 workspace 的事件。
      // 注意：不能在这里 resetForWorkspace()——服务端随后会推送 sessions:list 全量替换会话列表，
      // 而客户端自己发起的切换已在 activateWorkspace 里做过 reset 并选中目标会话；
      // 若此处再 reset，activeSessionId 被清空后 sessions:list 会兜底选中第一个会话，覆盖用户的选择。
      useWorkspaceStore.getState().setCurrentWorkspace(msg.payload)
      break
    case 'workspace:list': {
      const merged = mergeWorkspaces(useWorkspaceStore.getState().workspaces, msg.payload)
      const current = useWorkspaceStore.getState().currentWorkspace
      const updatedCurrent = current ? merged.find(w => w.id === current.id) ?? null : null
      useWorkspaceStore.setState(state => ({
        workspaces: merged,
        currentWorkspace: updatedCurrent ?? (state.currentWorkspace ? merged[0] ?? null : null),
      }))
      break
    }
  }
}
