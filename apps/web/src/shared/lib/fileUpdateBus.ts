import type { FileChangeEvent } from '@akari/shared-types'

type FileUpdateHandler = (payload: FileChangeEvent) => void

/**
 * 该文件事件是否意味着「内容可能有变化、需要重新拉取」。
 * unlink（文件被删除）不算——VSCode 的 textFileEditorModel.onDidFilesChange 对 DELETED
 * 只标记孤儿态、不重新读盘，避免对已不存在的路径拉取失败弹 toast（重命名/移动会广播旧路径 unlink）。
 */
export function isContentChange(event: FileChangeEvent): boolean {
  return event.changeType !== 'unlink'
}

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
