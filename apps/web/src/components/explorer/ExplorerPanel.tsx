import { useState, useCallback, useEffect, useRef } from 'react'
import type { AgentSession, FileNode } from '@akari/shared-types'
import { API_BASE } from '@/stores/session-store'
import { FileTreeNode } from './FileTreeNode'

interface ExplorerPanelProps {
  session: AgentSession
  onOpenFile: (path: string) => void
}

export function ExplorerPanel({ session, onOpenFile }: ExplorerPanelProps) {
  const [childrenCache, setChildrenCache] = useState<Map<string, FileNode[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const wasInitializingRef = useRef(session.status === 'initializing')

  // Load root directory on mount / session change
  useEffect(() => {
    setChildrenCache(new Map())
    setSelectedPath(undefined)
    setError(null)
    wasInitializingRef.current = session.status === 'initializing'
    loadDir('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // 当 worktree 就绪后（initializing → 其他状态），自动刷新文件树
  useEffect(() => {
    if (wasInitializingRef.current && session.status !== 'initializing') {
      wasInitializingRef.current = false
      setError(null)
      loadDir('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status])

  const loadDir = useCallback(async (path: string): Promise<FileNode[]> => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.id}/files?path=${encodeURIComponent(path)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const nodes: FileNode[] = await res.json()
      setChildrenCache(prev => {
        const next = new Map(prev)
        next.set(path, nodes)
        return next
      })
      return nodes
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return []
    } finally {
      setLoading(false)
    }
  }, [session.id])

  const handleToggleDir = useCallback(async (path: string): Promise<FileNode[]> => {
    const cached = childrenCache.get(path)
    if (cached) return cached
    return loadDir(path)
  }, [childrenCache, loadDir])

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path)
    onOpenFile(path)
  }, [onOpenFile])

  const rootNodes = childrenCache.get('') ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && rootNodes.length === 0 && (
          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            加载中...
          </div>
        )}
        {error && rootNodes.length === 0 && (
          <div className="px-3 py-4 text-xs text-red-400">
            加载失败: {error}
          </div>
        )}
        {rootNodes.map(node => (
          <FileTreeNode
            key={node.path}
            node={node}
            level={0}
            selectedPath={selectedPath}
            onSelectFile={handleSelectFile}
            onToggleDir={handleToggleDir}
            childrenCache={childrenCache}
          />
        ))}
        {!loading && rootNodes.length === 0 && !error && (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            暂无文件
          </div>
        )}
      </div>
    </div>
  )
}
