import { useState, useCallback, useEffect, useRef } from 'react'
import type { AgentSession, FileNode } from '@akari/shared-types'
import {
  fetchFileTreeChildren,
  getFileTreeChildren,
  getFileTreePathsForSession,
  useFileTreeChildren,
} from '@/lib/file-tree-store'
import { ArboristFileTree } from './ArboristFileTree'
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

    try {
      setError(null)
      return await fetchFileTreeChildren(session.id, path)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ExplorerPanel] loadDir error path="${path}"`, msg)
      setError(msg)
      return []
    }
  }, [session.id])

  const wasInitializingRef = useRef(session.status === 'initializing')

  useEffect(() => {
    const isInitializing = session.status === 'initializing'

    if (session.id !== lastSessionIdRef.current) {
      lastSessionIdRef.current = session.id
      setSelectedPath(undefined)
      setError(null)
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

  const rootChildren = useFileTreeChildren(session.id, '')

  const handleOpenFile = useCallback((path: string) => {
    setSelectedPath(path)
    onOpenFile(path)
  }, [onOpenFile])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error && (
        <div className="shrink-0 px-3 py-2 text-xs text-red-400">
          加载失败: {error}
        </div>
      )}

      {rootChildren === undefined && !error && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          加载中...
        </div>
      )}

      {rootChildren !== undefined && (
        <ArboristFileTree
          sessionId={session.id}
          rootName={getRootFolderName(session.worktreePath)}
          selectedPath={selectedPath}
          onOpenFile={handleOpenFile}
          onContextMenu={handleContextMenu}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
      )}

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
