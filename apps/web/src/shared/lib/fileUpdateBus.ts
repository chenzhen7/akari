import type { FileChangeEvent } from '@akari/shared-types'

type FileUpdateHandler = (payload: FileChangeEvent) => void

const listeners = new Map<string, Set<FileUpdateHandler>>()

export const fileUpdateBus = {
  emit(sessionId: string, payload: FileChangeEvent): void {
    listeners.get(sessionId)?.forEach(handler => handler(payload))
  },

  on(sessionId: string, handler: FileUpdateHandler): () => void {
    if (!listeners.has(sessionId)) {
      listeners.set(sessionId, new Set())
    }
    listeners.get(sessionId)!.add(handler)
    return () => {
      listeners.get(sessionId)?.delete(handler)
    }
  },

  destroy(sessionId: string): void {
    listeners.delete(sessionId)
  },
}
