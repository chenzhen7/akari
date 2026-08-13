import { create } from 'zustand'
import type { FileNode } from '@akari/shared-types'

export type ClipboardMode = 'copy' | 'cut'

export interface ClipboardItem {
  path: string
  name: string
  type: FileNode['type']
}

interface ClipboardState {
  /** 剪贴板所属会话；粘贴/剪切样式仅在该会话内生效 */
  sessionId: string | null
  mode: ClipboardMode | null
  /** 数组为将来多选预留；当前总是 1 项 */
  items: ClipboardItem[]
  setClipboard: (sessionId: string, mode: ClipboardMode, items: ClipboardItem[]) => void
  clearClipboard: () => void
}

export const useClipboardStore = create<ClipboardState>(set => ({
  sessionId: null,
  mode: null,
  items: [],
  setClipboard: (sessionId, mode, items) => set({ sessionId, mode, items }),
  clearClipboard: () => set({ sessionId: null, mode: null, items: [] }),
}))
