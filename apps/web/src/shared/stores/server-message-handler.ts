import type { AgentSession, ServerMessage } from '@akari/shared-types'
import { terminalBus } from '@/features/terminal/lib/terminalBus'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'
import { useSessionStore, findSession } from '@/features/session/stores/session-store'
import { useUnreadStore } from '@/features/session/stores/unread-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import { useConnectionStore } from '@/features/terminal/stores/connection-store'
import { useWorkspaceStore, mergeWorkspaces } from '@/features/workspace/stores/workspace-store'

export function handleServerMessage(msg: ServerMessage): void {
  switch (msg.event) {
    case 'sessions:list': {
      const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspace?.id
      if (currentWorkspaceId) {
        useWorkspaceStore.setState(state => ({
          workspaceSessions: { ...state.workspaceSessions, [currentWorkspaceId]: msg.payload },
        }))
      }
      // 数据更新不改变用户选中；仅当选中项在列表中已失效时修正（见 navigation-store.reconcile）
      useNavigationStore.getState().reconcile(msg.payload.map((s: AgentSession) => s.id))
      break
    }
    case 'session:created':
      useWorkspaceStore.getState().addSession(msg.payload)
      break
    case 'session:updated':
      useWorkspaceStore.getState().updateSession(msg.payload.id, msg.payload)
      break
    case 'session:status':
      useWorkspaceStore.getState().updateSession(msg.payload.id, {
        status: msg.payload.status,
        progress: msg.payload.progress,
        kanbanColumn: msg.payload.kanbanColumn,
      })
      break
    case 'session:deleted': {
      useWorkspaceStore.getState().removeSession(msg.payload.id)
      useSessionStore.getState().clearGitLog(msg.payload.id)
      useUnreadStore.getState().markRead(msg.payload.id)
      // 若被删的恰是当前选中会话，重选当前工作区第一个会话
      const ws = useWorkspaceStore.getState()
      const wsId = ws.currentWorkspace?.id
      const ids = wsId ? (ws.workspaceSessions[wsId] ?? []).map(s => s.id) : []
      useNavigationStore.getState().reconcile(ids)
      break
    }
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
      useWorkspaceStore.getState().updateSession(msg.payload.sessionId, {
        diffSummary: msg.payload.diff.summary,
        diffFiles: msg.payload.diff.files,
      })
      break
    case 'git:ahead-behind':
      useWorkspaceStore.getState().updateSession(msg.payload.sessionId, {
        aheadBehind: msg.payload.aheadBehind,
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
      useWorkspaceStore.getState().updateSession(msg.payload.id, {
        lastAiMessage: msg.payload.lastAiMessage,
      })
      break
    case 'session:unread':
      // 当前正在查看的会话不标未读
      if (msg.payload.id !== useNavigationStore.getState().sessionId) {
        useUnreadStore.getState().markUnread(msg.payload.id)
      }
      break
    case 'tab:created': {
      const ws = useWorkspaceStore.getState()
      const session = findSession(ws.workspaceSessions, msg.payload.sessionId)
      if (session) {
        ws.updateSession(msg.payload.sessionId, { tabs: [...session.tabs, msg.payload.tab] })
      }
      break
    }
    case 'tab:closed': {
      const ws = useWorkspaceStore.getState()
      const session = findSession(ws.workspaceSessions, msg.payload.sessionId)
      if (!session) break
      const updatedTabs = session.tabs.filter(t => t.id !== msg.payload.tabId)
      let activeTabId = session.activeTabId
      if (activeTabId === msg.payload.tabId) {
        activeTabId = updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null
      }
      ws.updateSession(msg.payload.sessionId, { tabs: updatedTabs, activeTabId })
      break
    }
    case 'tab:activated':
      useWorkspaceStore.getState().updateSession(msg.payload.sessionId, { activeTabId: msg.payload.tabId })
      break
    case 'tab:title': {
      // 只更新目标 tab 的实时标题，避免用 tabs:sync 整表覆盖并发改动
      const ws = useWorkspaceStore.getState()
      const session = findSession(ws.workspaceSessions, msg.payload.sessionId)
      if (!session) break
      const updatedTabs = session.tabs.map(tab =>
        tab.id === msg.payload.tabId ? { ...tab, titleFromShell: msg.payload.title } : tab,
      )
      ws.updateSession(msg.payload.sessionId, { tabs: updatedTabs })
      break
    }
    case 'tabs:sync':
      useWorkspaceStore.getState().updateSession(msg.payload.sessionId, {
        tabs: msg.payload.tabs,
        activeTabId: msg.payload.activeTabId,
      })
      break
    case 'workspace:activated':
      // 仅代表「某项目被显式激活/切换」。桌面端每个窗口只会收到自己 workspace 的事件。
      // 客户端自己发起的切换已在 activateWorkspace 里设置好导航选中态，这里无需重置——
      // 数据/选中分离后，workspace:activated 只更新 currentWorkspace，sessions:list 也只写缓存，
      // 两者都不会覆盖用户的选中。
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
