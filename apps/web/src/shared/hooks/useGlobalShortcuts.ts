import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/features/session/stores/session-store'
import { useUIStore } from '@/shared/stores/ui-store'
import { useConnectionStore } from '@/features/terminal/stores/connection-store'
import { useTabStore } from '@/features/session/stores/tab-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { destroyTerminalInstance } from '@/features/session/lib/terminal-instances'
import { toastError } from '@/shared/lib/toast'
import { SHORTCUTS, matchCombo, isTypingTarget, type ShortcutId } from '@/shared/lib/shortcuts'

interface ShortcutHandlers {
  /** 切换左侧会话列表（状态在 AppShell 中，需外部注入） */
  toggleLeft: () => void
  /** 切换右侧详情面板 */
  toggleRight: () => void
}

/**
 * 注册全局快捷键。在 window 捕获阶段监听 keydown，匹配到即拦截，
 * 阻止按键继续传到终端（xterm）的 textarea。
 */
export function useGlobalShortcuts({ toggleLeft, toggleRight }: ShortcutHandlers): void {
  // 用 ref 保存最新的 toggle 回调，避免因依赖变化反复重建监听器
  const handlersRef = useRef({ toggleLeft, toggleRight })
  handlersRef.current = { toggleLeft, toggleRight }

  useEffect(() => {
    function dispatch(id: ShortcutId): void {
      const sessionStore = useSessionStore.getState()
      const uiStore = useUIStore.getState()
      const connectionStore = useConnectionStore.getState()
      const activeSessionId = sessionStore.activeSessionId
      const session = activeSessionId ? sessionStore.sessions.find(s => s.id === activeSessionId) : undefined

      switch (id) {
        case 'toggle-left':
          handlersRef.current.toggleLeft()
          break
        case 'toggle-right':
          handlersRef.current.toggleRight()
          break
        case 'new-session': {
          const ws = useWorkspaceStore.getState().currentWorkspace
          if (ws?.isGit === false) {
            toastError('当前项目不是 Git 仓库，无法创建会话')
            break
          }
          uiStore.openCreateDialog()
          break
        }
        case 'new-terminal':
          if (session) connectionStore.createTerminal(session.id, 'shell')
          break
        case 'close-tab':
          if (session?.activeTabId) closeActiveTab(session.id, session.activeTabId)
          break
        case 'next-tab':
          if (session) cycleTab(session.id, session.tabs, session.activeTabId, +1)
          break
        case 'prev-tab':
          if (session) cycleTab(session.id, session.tabs, session.activeTabId, -1)
          break
        case 'command-center':
          uiStore.toggleCommandCenter()
          break
        case 'kanban':
          sessionStore.setGlobalViewMode(sessionStore.globalViewMode === 'kanban' ? null : 'kanban')
          break
        case 'settings':
          uiStore.setSettingsOpen(true)
          break
        case 'help':
          uiStore.toggleShortcutsHelp()
          break
      }
    }

    function closeActiveTab(sessionId: string, tabId: string): void {
      const session = useSessionStore.getState().sessions.find(s => s.id === sessionId)
      const tab = session?.tabs.find(t => t.id === tabId)
      if (tab && (tab.type === 'terminal' || tab.type === 'agent') && tab.terminalId) {
        destroyTerminalInstance(tab.terminalId)
      }
      useTabStore.getState().closeTab(sessionId, tabId)
    }

    function cycleTab(
      sessionId: string,
      tabs: { id: string }[],
      activeTabId: string | null,
      dir: 1 | -1,
    ): void {
      if (tabs.length < 2) return
      const idx = tabs.findIndex(t => t.id === activeTabId)
      const current = idx === -1 ? 0 : idx
      const next = (current + dir + tabs.length) % tabs.length
      useTabStore.getState().activateTab(sessionId, tabs[next].id)
    }

    function gotoSession(n: number): boolean {
      const store = useSessionStore.getState()
      // 按侧边栏渲染顺序排列：主会话 → 活动会话 → 归档会话
      const regular = store.sessions.filter(s => !s.isMain)
      const ordered = [
        ...store.sessions.filter(s => s.isMain),
        ...regular.filter(s => s.status !== 'archived'),
        ...regular.filter(s => s.status === 'archived'),
      ]
      if (n < 1 || n > ordered.length) return false
      store.selectSession(ordered[n - 1].id)
      return true
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.repeat) return
      if (isTypingTarget(e.target)) return

      // Ctrl+1~9 跳转会话（单独处理，避免与字母组合键混在一起）
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        if (gotoSession(Number(e.key))) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }

      const matched = SHORTCUTS.find(s => matchCombo(e, s.combo))
      if (!matched) return

      e.preventDefault()
      e.stopPropagation()
      dispatch(matched.id)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
}
