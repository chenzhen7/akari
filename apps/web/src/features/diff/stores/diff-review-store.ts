import { create } from 'zustand'

interface FileReviewState {
  filePath: string
  viewed: boolean
}

interface DiffReviewStoreState {
  states: Record<string, Record<string, FileReviewState>>
  scrollTargets: Record<string, { filePath: string; version: number } | undefined>
}

interface DiffReviewStoreActions {
  setFileViewed(sessionId: string, filePath: string, viewed: boolean): void
  getFileViewed(sessionId: string, filePath: string): boolean
  setScrollTarget(sessionId: string, filePath: string): void
  getScrollTarget(sessionId: string): { filePath: string; version: number } | undefined
  resetSession(sessionId: string): void
  reconcileSession(sessionId: string, files: string[]): void
}

type DiffReviewStore = DiffReviewStoreState & DiffReviewStoreActions

export const useDiffReviewStore = create<DiffReviewStore>((set, get) => ({
  states: {},
  scrollTargets: {},

  setFileViewed(sessionId, filePath, viewed) {
    set((state) => {
      const nextStates = { ...state.states }
      const sessionState = nextStates[sessionId] ? { ...nextStates[sessionId] } : {}
      sessionState[filePath] = { filePath, viewed }
      nextStates[sessionId] = sessionState
      return { states: nextStates }
    })
  },

  getFileViewed(sessionId, filePath) {
    return get().states[sessionId]?.[filePath]?.viewed ?? false
  },

  setScrollTarget(sessionId, filePath) {
    set((state) => {
      const existing = state.scrollTargets[sessionId]
      return {
        scrollTargets: {
          ...state.scrollTargets,
          [sessionId]: { filePath, version: (existing?.version ?? 0) + 1 },
        },
      }
    })
  },

  getScrollTarget(sessionId) {
    return get().scrollTargets[sessionId]
  },

  resetSession(sessionId) {
    set((state) => {
      const nextStates = { ...state.states }
      delete nextStates[sessionId]
      const nextScrollTargets = { ...state.scrollTargets }
      delete nextScrollTargets[sessionId]
      return { states: nextStates, scrollTargets: nextScrollTargets }
    })
  },

  reconcileSession(sessionId, files) {
    set((state) => {
      const nextStates = { ...state.states }
      const sessionState = nextStates[sessionId] ? { ...nextStates[sessionId] } : {}
      const validFiles = new Set(files)

      for (const filePath of Object.keys(sessionState)) {
        if (!validFiles.has(filePath)) {
          delete sessionState[filePath]
        }
      }

      nextStates[sessionId] = sessionState
      return { states: nextStates }
    })
  },
}))
