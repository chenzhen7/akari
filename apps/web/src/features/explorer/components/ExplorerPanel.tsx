import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { AgentSession, FileNode } from '@akari/shared-types'
import {
  fetchFileTreeChildren,
  getFileTreeChildren,
  getFileTreePathsForSession,
  useFileTreeChildren,
} from '@/features/explorer/lib/file-tree-store'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/shared/components/ui/context-menu'
import { ArboristFileTree } from './ArboristFileTree'
import { FileTreeContextMenuContent } from './FileTreeContextMenuContent'
import { FileMutationDialog, type FileMutation } from './FileMutationDialog'

interface ExplorerPanelProps {
  session: AgentSession
  onOpenFile: (path: string) => void
}

function getRootFolderName(worktreePath: string): string {
  const parts = worktreePath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? worktreePath
}

function getActiveFilePath(session: AgentSession): string | undefined {
  const tab = session.tabs.find(
    t => t.id === session.activeTabId && (t.type === 'file' || t.type === 'diff'),
  )
  return tab?.filePath
}

export function ExplorerPanel({ session, onOpenFile }: ExplorerPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [menuNode, setMenuNode] = useState<FileNode | null>(null)
  // 每次右键递增，作为 ContextMenuContent 的 key，强制重挂载以让 floating 在新坐标重新定位
  const [menuSeq, setMenuSeq] = useState(0)
  const [mutation, setMutation] = useState<FileMutation | null>(null)
  const lastSessionIdRef = useRef<string | null>(null)

  const activeFilePath = useMemo(() => getActiveFilePath(session), [session])

  // 与中间编辑区的当前标签保持同步：进入文件/ diff 编辑区时高亮对应文件
  useEffect(() => {
    setSelectedPath(activeFilePath)
  }, [activeFilePath])

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

  // 由 ContextMenuTrigger 的 onContextMenu 触发：命中行读取 data-path 得到目标节点，
  // 空白处（行外）视为根目录；不自行记录坐标，定位交给 Radix。
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    setMenuSeq(n => n + 1)
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-path]')
    if (el) {
      const path = el.dataset.path ?? ''
      const type = (el.dataset.type as FileNode['type'] | undefined) ?? 'file'
      setMenuNode({ path, type, name: path.split(/[/\\]/).pop() ?? path })
    } else {
      setMenuNode({ path: '', type: 'directory', name: '' })
    }
  }, [])

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

  // 文件变更提交后：先全量刷新缓存（保证新路径已进入），再维护选中态
  const handleCommitted = useCallback(
    async (result: { action: FileMutation['type']; path: string }) => {
      await handleRefresh()
      if (result.action === 'rename') {
        setSelectedPath(result.path)
      } else if (result.action === 'delete') {
        setSelectedPath(prev =>
          prev === result.path || prev?.startsWith(result.path + '/') ? undefined : prev,
        )
      } else if (result.action === 'create-file') {
        setSelectedPath(result.path)
        onOpenFile(result.path)
      }
    },
    [handleRefresh, onOpenFile],
  )

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
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild onContextMenu={handleContextMenu}>
            <div className="min-h-0 flex-1">
              <ArboristFileTree
                sessionId={session.id}
                rootName={getRootFolderName(session.worktreePath)}
                selectedPath={selectedPath}
                onOpenFile={handleOpenFile}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
                onCreateFile={parentPath => setMutation({ type: 'create-file', parentPath })}
                onCreateFolder={parentPath => setMutation({ type: 'create-folder', parentPath })}
              />
            </div>
          </ContextMenuTrigger>
          <FileTreeContextMenuContent
            key={menuSeq}
            sessionId={session.id}
            terminalId={session.terminalId}
            worktreePath={session.worktreePath}
            node={menuNode}
            onMutation={setMutation}
          />
        </ContextMenu>
      )}

      {mutation && (
        <FileMutationDialog
          sessionId={session.id}
          mutation={mutation}
          onClose={() => setMutation(null)}
          onCommitted={handleCommitted}
        />
      )}
    </div>
  )
}
