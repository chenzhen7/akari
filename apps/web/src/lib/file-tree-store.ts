import { useSyncExternalStore } from 'react'
import type { FileNode } from '@akari/shared-types'
import { API_BASE } from './api'

const cache = new Map<string, FileNode[]>()
const listeners = new Set<() => void>()

function cacheKey(sessionId: string, path: string): string {
  return `${sessionId}:${path}`
}

function notify(): void {
  listeners.forEach(listener => listener())
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
  return useSyncExternalStore(
    callback => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    () => getFileTreeChildren(sessionId, path),
  )
}

export async function fetchFileTreeChildren(sessionId: string, path: string): Promise<FileNode[]> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
  const nodes: FileNode[] = await res.json()
  setFileTreeChildren(sessionId, path, nodes)
  return nodes
}
