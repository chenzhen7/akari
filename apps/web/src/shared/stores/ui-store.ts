import { create } from 'zustand'
import { useSessionStore } from '@/features/session/stores/session-store'

interface UIStore {
  commandCenterOpen: boolean
  createDialogOpen: boolean
  settingsOpen: boolean
  shortcutsHelpOpen: boolean
  activeRightTab: 'git-graph' | 'diff' | 'info' | 'explorer'

  toggleCommandCenter: () => void
  toggleCreateDialog: () => void
  closeCreateDialog: () => void
  openCreateDialog: (position?: { x: number; y: number }) => void
  setSettingsOpen: (open: boolean) => void
  toggleShortcutsHelp: () => void
  setShortcutsHelpOpen: (open: boolean) => void
  setActiveRightTab: (tab: 'git-graph' | 'diff' | 'info' | 'explorer') => void
}

export const useUIStore = create<UIStore>((set) => ({
  commandCenterOpen: false,
  createDialogOpen: false,
  settingsOpen: false,
  shortcutsHelpOpen: false,
  activeRightTab: 'explorer',

  toggleCommandCenter: () =>
    set(state => ({ commandCenterOpen: !state.commandCenterOpen })),

  toggleCreateDialog: () =>
    set(state => ({ createDialogOpen: !state.createDialogOpen })),

  closeCreateDialog: () => set({ createDialogOpen: false }),

  openCreateDialog: (position) => {
    useSessionStore.getState().setPendingCreatePosition(position ?? null)
    set({ createDialogOpen: true })
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  toggleShortcutsHelp: () =>
    set(state => ({ shortcutsHelpOpen: !state.shortcutsHelpOpen })),

  setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),

  setActiveRightTab: (tab) => set({ activeRightTab: tab }),
}))
