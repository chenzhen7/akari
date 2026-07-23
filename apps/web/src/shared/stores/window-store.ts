import { create } from 'zustand'

interface WindowState {
  windowId: number | null
  workspaceId: string | null
  setWindowId: (id: number) => void
  setWorkspaceId: (id: string) => void
}

function getInitialWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('workspaceId')
}

export const useWindowStore = create<WindowState>((set) => ({
  windowId: null,
  workspaceId: getInitialWorkspaceId(),
  setWindowId: (id) => set({ windowId: id }),
  setWorkspaceId: (id) => set({ workspaceId: id }),
}))
