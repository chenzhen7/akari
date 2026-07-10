import { useState, useCallback, useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentSession, FileNode } from '@akari/shared-types'
import { cn } from '@/lib/utils'
import {
  fetchFileTreeChildren,
  getFileTreeChildren,
  getFileTreePathsForSession,
  useFileTreeChildren,
} from '@/lib/file-tree-store'
import { FileTreeNode } from './FileTreeNode'
import { FileTreeContextMenu } from './FileTreeContextMenu'

interface ExplorerPanelProps {
  session: AgentSession
  onOpenFile: (path: string) => void
}

function getRootFolderName(worktreePath: string): string {
  const parts = worktreePath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? worktreePath
}

export function ExplorerPanel({ session, onOpenFile }: ExplorerPanelProps) {
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const lastSessionIdRef = useRef<string | null>(null)

  const loadDir = useCallback(async (path: string): Promise<FileNode[]> => {
    const cached = getFileTreeChildren(session.id, path)
    if (cached) {
      fetchFileTreeChildren(session.id, path).catch(err => {
        console.error(`[ExplorerPanel] background refresh failed path="${path}"`, err)
      })
      return cached
    }

    setLoadingPaths(prev => new Set(prev).add(path))
    try {
      const nodes = await fetchFileTreeChildren(session.id, path)
      return nodes
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ExplorerPanel] loadDir error path="${path}"`, msg)
      setError(msg)
      return []
    } finally {
      setLoadingPaths(prev => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [session.id])

  const wasInitializingRef = useRef(session.status === 'initializing')

  useEffect(() => {
    const isInitializing = session.status === 'initializing'

    if (session.id !== lastSessionIdRef.current) {
      lastSessionIdRef.current = session.id
      setSelectedPath(undefined)
      setError(null)
      setLoadingPaths(new Set())
      setIsRefreshing(false)
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
  }, [session.id, session.status, loadDir])

  const handleToggleDir = useCallback(async (path: string): Promise<void> => {
    await loadDir(path)
  }, [loadDir])

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path)
    onOpenFile(path)
  }, [onOpenFile])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      let paths = getFileTreePathsForSession(session.id)
      if (paths.length === 0) {
        paths = ['']
      }
      await Promise.all(
        paths.map(path =>
          fetchFileTreeChildren(session.id, path).catch(err => {
            console.error(`[ExplorerPanel] refresh failed path="${path}"`, err)
          }),
        ),
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [session.id])

  const rootNode: FileNode = {
    name: getRootFolderName(session.worktreePath),
    path: '',
    type: 'directory',
  }

  const rootChildren = useFileTreeChildren(session.id, '')
  const isRootLoading = loadingPaths.has('')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto py-1">
        {error && (
          <div className="px-3 py-4 text-xs text-red-400">
            加载失败: {error}
          </div>
        )}

        {isRootLoading && rootChildren === undefined && (
          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            加载中...
          </div>
        )}

        <FileTreeNode
          sessionId={session.id}
          node={rootNode}
          level={0}
          defaultExpanded={true}
          selectedPath={selectedPath}
          onSelectFile={handleSelectFile}
          onToggleDir={handleToggleDir}
          onContextMenu={handleContextMenu}
          actions={
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="刷新"
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
            </button>
          }
        />
      </div>

      {contextMenu && (
        <FileTreeContextMenu
          sessionId={session.id}
          terminalId={session.terminalId}
          worktreePath={session.worktreePath}
          node={contextMenu.node}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}
