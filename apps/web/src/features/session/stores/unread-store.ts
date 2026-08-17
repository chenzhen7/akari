import { create } from 'zustand'
import { useNavigationStore } from '@/shared/stores/navigation-store'

/**
 * 会话未读标记：纯内存、不持久化。
 * 后端收到 PermissionRequest / Stop Hook 时广播 session:unread → markUnread；
 * 用户选中会话（navigation-store.sessionId 变化）→ 自动 markRead。
 */
interface UnreadStore {
  unreadIds: ReadonlySet<string>
  markUnread: (sessionId: string) => void
  markRead: (sessionId: string) => void
}

export const useUnreadStore = create<UnreadStore>((set) => ({
  unreadIds: new Set<string>(),

  markUnread(sessionId) {
    set((state) => {
      if (state.unreadIds.has(sessionId)) return state
      return { unreadIds: new Set(state.unreadIds).add(sessionId) }
    })
  },

  markRead(sessionId) {
    set((state) => {
      if (!state.unreadIds.has(sessionId)) return state
      const next = new Set(state.unreadIds)
      next.delete(sessionId)
      return { unreadIds: next }
    })
  },
}))

/** 选中会话变化时自动清除该会话的未读标记 */
useNavigationStore.subscribe((state) => {
  if (state.sessionId) {
    useUnreadStore.getState().markRead(state.sessionId)
  }
})

/** 单个会话的未读订阅选择器 */
export function useIsUnread(sessionId: string): boolean {
  return useUnreadStore((s) => s.unreadIds.has(sessionId))
}
