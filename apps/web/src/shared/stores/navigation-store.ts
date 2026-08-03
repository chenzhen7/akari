import { create } from 'zustand'

/**
 * 导航层：只描述「当前看什么」，不含任何会话数据。
 *
 * 不变量：sessionId 与 viewMode 互斥。
 * - selectSession 选中一个会话 → viewMode 置 null，中间窗格显示该会话；
 * - setViewMode 切到全局视图 → sessionId 置 null，中间窗格显示看板/画布；
 * - 两者都为 null → 空状态。
 *
 * 数据更新（sessions:list / session:deleted）不得改动选中态；
 * 唯一修正入口是 reconcile()，且只在 viewMode 为 null 时生效，避免破坏互斥不变量。
 */
export type GlobalViewMode = 'canvas' | 'kanban' | null

interface NavigationState {
  sessionId: string | null
  viewMode: GlobalViewMode

  /** 选中一个会话（同时退出全局视图） */
  selectSession: (sessionId: string) => void
  /** 切换到全局视图（同时取消会话选中） */
  setViewMode: (mode: GlobalViewMode) => void
  /**
   * 切换工作区：一次性设置选中态，无中间态、不闪烁。
   * 有目标会话则选中目标，否则回退到第一个可用会话（如有）。
   */
  selectWorkspaceSession: (targetSessionId: string | null, availableSessionIds: string[]) => void
  /**
   * 数据更新后修正选中：仅当「当前选中项在列表中已不存在」时重选第一个。
   * 全局视图激活时不做任何事，保持互斥不变量。
   */
  reconcile: (availableSessionIds: string[]) => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  sessionId: null,
  viewMode: null,

  selectSession: (sessionId) => set({ sessionId, viewMode: null }),

  setViewMode: (viewMode) => set({ viewMode, sessionId: null }),

  selectWorkspaceSession: (targetSessionId, availableSessionIds) =>
    set({
      sessionId: targetSessionId ?? (availableSessionIds.length > 0 ? availableSessionIds[0] : null),
      viewMode: null,
    }),

  reconcile: (availableSessionIds) =>
    set((state) => {
      if (state.viewMode) return state
      if (state.sessionId && availableSessionIds.includes(state.sessionId)) return state
      return { sessionId: availableSessionIds.length > 0 ? availableSessionIds[0] : null }
    }),
}))
