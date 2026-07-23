import { useSyncExternalStore } from 'react'
import { apiClient } from '@/shared/lib/api-client'
import type { FileNode } from '@akari/shared-types'

const cache = new Map<string, FileNode[]>()
const listeners = new Set<() => void>()
let tick = 0

function cacheKey(sessionId: string, path: string): string {
  return `${sessionId}:${path}`
}

function notify(): void {
  tick++
  listeners.forEach(listener => listener())
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function getFileTreeChildren(sessionId: string, path: string): FileNode[] | undefined {
  return cache.get(cacheKey(sessionId, path))
}

export function setFileTreeChildren(sessionId: string, path: string, nodes: FileNode[]): void {
  cache.set(cacheKey(sessionId, path), nodes)
  notify()
}

export function clearFileTreeForSession(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key)
    }
  }
  notify()
}

export function getFileTreePathsForSession(sessionId: string): string[] {
  const prefix = `${sessionId}:`
  const paths: string[] = []
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      paths.push(key.slice(prefix.length))
    }
  }
  return paths
}

export function useFileTreeChildren(sessionId: string, path: string): FileNode[] | undefined {
  return useSyncExternalStore(subscribe, () => getFileTreeChildren(sessionId, path))
}

export function useFileTreeTick(): number {
  return useSyncExternalStore(subscribe, () => tick)
}

export async function fetchFileTreeChildren(sessionId: string, path: string): Promise<FileNode[]> {
  const nodes = await apiClient.get<FileNode[]>(`/sessions/${sessionId}/files`, {
    params: { path },
    toast: false,
  })
  setFileTreeChildren(sessionId, path, nodes)
  return nodes
}
