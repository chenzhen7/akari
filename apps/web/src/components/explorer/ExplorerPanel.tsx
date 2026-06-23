import { useState, useCallback, useEffect, useRef } from 'react'
import type { AgentSession, FileNode } from '@akari/shared-types'
import { API_BASE } from '@/stores/session-store'
import { FileTreeNode } from './FileTreeNode'

const globalFileTreeCache = new Map<string, FileNode[]>()

function cacheKey(sessionId: string, path: string): string {
  return `${sessionId}:${path}`
}

interface ExplorerPanelProps {
  session: AgentSession
  onOpenFile: (path: string) => void
}

export function ExplorerPanel({ session, onOpenFile }: ExplorerPanelProps) {
  const [childrenCache, setChildrenCache] = useState<Map<string, FileNode[]>>(new Map())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const lastSessionIdRef = useRef(session.id)

  const fetchDir = useCallback(async (path: string, key: string): Promise<FileNode[]> => {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/files?path=${encodeURIComponent(path)}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    const nodes: FileNode[] = await res.json()
    globalFileTreeCache.set(key, nodes)
    setChildrenCache(prev => {
      const next = new Map(prev)
      next.set(path, nodes)
      return next
    })
    return nodes
  }, [session.id])

  const loadDir = useCallback(async (path: string): Promise<FileNode[]> => {
    const key = cacheKey(session.id, path)
    const cached = globalFileTreeCache.get(key)

    if (cached) {
      // 命中缓存：立即渲染，后台静默刷新
      setChildrenCache(prev => {
        const next = new Map(prev)
        next.set(path, cached)
        return next
      })
      fetchDir(path, key).catch(() => {
        // 后台刷新失败不影响当前已渲染的缓存数据
      })
      return cached
    }

    // 未命中缓存：前台加载并展示 loading
    setLoadingPaths(prev => new Set(prev).add(path))
    try {
      return await fetchDir(path, key)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      return []
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [session.id, fetchDir])

  const wasInitializingRef = useRef(session.status === 'initializing')

  // 挂载 / 切换会话 / 工作区就绪时加载根目录
  useEffect(() => {
    const isInitializing = session.status === 'initializing'

    if (session.id !== lastSessionIdRef.current) {
      lastSessionIdRef.current = session.id
      setSelectedPath(undefined)
      setError(null)
      setChildrenCache(new Map())
      wasInitializingRef.current = isInitializing
      if (!isInitializing) {
        loadDir('')
      }
      return
    }

    if (wasInitializingRef.current && !isInitializing) {
      wasInitializingRef.current = false
      loadDir('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.status])

  const handleToggleDir = useCallback(async (path: string): Promise<FileNode[]> => {
    const key = cacheKey(session.id, path)
    const cached = childrenCache.get(path) ?? globalFileTreeCache.get(key)
    if (cached) return cached
    return loadDir(path)
  }, [childrenCache, loadDir, session.id])

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path)
    onOpenFile(path)
  }, [onOpenFile])

  const rootNodes = childrenCache.get('') ?? []
  const isRootLoading = loadingPaths.has('')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {isRootLoading && rootNodes.length === 0 && (
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
        {!isRootLoading && rootNodes.length === 0 && !error && (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            暂无文件
          </div>
        )}
      </div>
    </div>
  )
}
