import { create } from 'zustand'

interface WindowState {
  workspaceId: string | null
  setWorkspaceId: (id: string | null) => void
}

function getInitialWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('workspaceId')
}

export const useWindowStore = create<WindowState>((set) => ({
  workspaceId: getInitialWorkspaceId(),
  setWorkspaceId: (id) => set({ workspaceId: id }),
}))
