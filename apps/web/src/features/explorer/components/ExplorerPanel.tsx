import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { AgentSession, FileNode } from '@akari/shared-types'
import {
  fetchFileTreeChildren,
  getFileTreeChildren,
  getFileTreePathsForSession,
  useFileTreeChildren,
} from '@/features/explorer/lib/file-tree-store'
import { dirnameRelPath } from '@/features/explorer/lib/path-utils'
import { useClipboardStore } from '@/features/explorer/stores/clipboard-store'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/shared/components/ui/context-menu'
import { apiClient } from '@/shared/lib/api-client'
import { toast } from '@/shared/lib/toast'
import { cn } from '@/shared/lib/utils'
import { ArboristFileTree } from './ArboristFileTree'
import { FileTreeContextMenuContent, type ClipboardAction } from './FileTreeContextMenuContent'
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

/** 从 tree-store 缓存推断路径类型（可见/选中节点其父目录必然已加载）；找不到视为文件 */
function getNodeType(sessionId: string, path: string): FileNode['type'] {
  const parent = dirnameRelPath(path)
  const children = getFileTreeChildren(sessionId, parent)
  return children?.find(c => c.path === path)?.type ?? 'file'
}

/**
 * 粘贴目标目录（VSCode 规则）：
 * - 有 node：node 是源本身 → 其父目录；目录 → 自身；文件 → 其父目录
 * - 无 node（键盘）：selectedPath 空 → 根('')；是源本身 → 父目录；目录 → 自身；文件 → 父目录
 */
function resolvePasteTargetDir(
  sessionId: string,
  selectedPath: string | undefined,
  node: FileNode | null | undefined,
  sourcePath: string,
): string {
  if (node) {
    if (node.path === sourcePath) return dirnameRelPath(node.path)
    return node.type === 'directory' ? node.path : dirnameRelPath(node.path)
  }
  if (!selectedPath) return ''
  if (selectedPath === sourcePath) return dirnameRelPath(selectedPath)
  return getNodeType(sessionId, selectedPath) === 'directory' ? selectedPath : dirnameRelPath(selectedPath)
}

/** 拖拽上传目标目录：命中目录节点 → 该目录；命中文件节点 → 其父目录；空白处 → 沿用选中路径规则 */
function resolveDropTargetDir(
  sessionId: string,
  selectedPath: string | undefined,
  dropTarget: HTMLElement | null,
): string {
  const el = dropTarget?.closest('[data-path]') as HTMLElement | null
  if (el) {
    const path = el.dataset.path ?? ''
    const type = (el.dataset.type as FileNode['type'] | undefined) ?? 'file'
    return type === 'directory' ? path : dirnameRelPath(path)
  }
  if (!selectedPath) return ''
  return getNodeType(sessionId, selectedPath) === 'directory' ? selectedPath : dirnameRelPath(selectedPath)
}

export function ExplorerPanel({ session, onOpenFile }: ExplorerPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  // 树内实际选中的节点（由 react-arborist onSelect 同步），用于剪切/删除快捷键定位目标。
  // 与 selectedPath（"当前打开的编辑文件"）解耦：点目录不会打开文件，但仍应能剪切/删除。
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [menuNode, setMenuNode] = useState<FileNode | null>(null)
  // 每次右键递增，作为 ContextMenuContent 的 key，强制重挂载以让 floating 在新坐标重新定位
  const [menuSeq, setMenuSeq] = useState(0)
  const [mutation, setMutation] = useState<FileMutation | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const lastSessionIdRef = useRef<string | null>(null)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  // dragenter/dragleave 计数器：避免在子元素间移动时高亮闪烁
  const dragDepthRef = useRef(0)

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
    // Monaco 激活/挂载时会自行 focus（抢走焦点），这里把焦点夺回文件树，
    // 保证紧接着的 Ctrl+X / Delete 等树内快捷键可用。
    window.setTimeout(() => {
      treeContainerRef.current?.focus({ preventScroll: true })
    }, 0)
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
        setSelectedNode(prev =>
          prev && (prev.path === result.path || prev.path.startsWith(result.path + '/')) ? null : prev,
        )
      } else if (result.action === 'create-file') {
        setSelectedPath(result.path)
        onOpenFile(result.path)
      }
    },
    [handleRefresh, onOpenFile],
  )

  // 复制/剪切：写入剪贴板 store；粘贴：按 VSCode 规则解析 targetDir → 调后端 copy/move → 刷新并选中
  const handleClipboardAction = useCallback(
    async (action: ClipboardAction, node?: FileNode) => {
      if (action === 'copy' || action === 'cut') {
        const source = node ?? selectedNode
        if (!source) return
        useClipboardStore.getState().setClipboard(session.id, action, [
          { path: source.path, name: source.name, type: source.type },
        ])
        toast.success(action === 'cut' ? '已剪切' : '已复制')
        return
      }

      const clip = useClipboardStore.getState()
      if (clip.mode === null || clip.sessionId !== session.id) return
      const source = clip.items[0]
      if (!source) return
      const targetDir = resolvePasteTargetDir(session.id, selectedPath, node ?? selectedNode, source.path)
      const isCut = clip.mode === 'cut'
      try {
        const res = await apiClient.post<{ path: string }>(
          `/sessions/${session.id}/${isCut ? 'move' : 'copy'}`,
          { source: source.path, targetDir },
          { toast: isCut ? '移动失败' : '复制失败' },
        )
        const isNoop = isCut && res.path === source.path
        await handleRefresh()
        if (isNoop) {
          // 同文件夹剪切粘贴：无实际变化，仅清空剪切态
          useClipboardStore.getState().clearClipboard()
          return
        }
        setSelectedPath(res.path)
        if (clip.items.length === 1 && clip.items[0].type === 'file') onOpenFile(res.path)
        // 剪切成功后清空剪贴板；复制则保留，可多次粘贴
        if (isCut) useClipboardStore.getState().clearClipboard()
        toast.success(isCut ? '已移动' : '已复制')
      } catch (err) {
        // api-client 已按前缀 toast 错误
        console.error('[ExplorerPanel] clipboard paste failed:', err)
      }
    },
    [session.id, selectedPath, selectedNode, handleRefresh, onOpenFile],
  )

  // 逐个上传粘贴的外部文件（重名由后端自动加 copy 后缀），完成后刷新并选中最后上传的路径
  const uploadFiles = useCallback(
    async (files: File[], targetDir: string) => {
      let uploaded = 0
      let lastName = ''
      for (const file of files) {
        try {
          const res = await apiClient.upload<{ path: string }>(
            `/sessions/${session.id}/upload-file`,
            file,
            { params: { targetDir, name: file.name }, toast: `上传 ${file.name} 失败` },
          )
          uploaded++
          lastName = file.name
          setSelectedPath(res.path)
        } catch (err) {
          // api-client 已按前缀 toast 错误
          console.error(`[ExplorerPanel] upload "${file.name}" failed:`, err)
        }
      }
      await handleRefresh()
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? `已粘贴 ${lastName}` : `已粘贴 ${uploaded} 个文件`)
      }
    },
    [session.id, handleRefresh],
  )

  // 粘贴外部文件（OS 剪贴板）：clipboardData 含文件 → 上传到选中目录；无 → 走内部复制/剪切粘贴
  const handleTreePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const dt = e.clipboardData
      if (!dt) return
      const files = Array.from(dt.files ?? [])
      if (files.length === 0) {
        void handleClipboardAction('paste')
        return
      }
      e.preventDefault()
      const targetDir = resolvePasteTargetDir(session.id, selectedPath, selectedNode, '')
      void uploadFiles(files, targetDir)
    },
    [session.id, selectedPath, selectedNode, handleClipboardAction, uploadFiles],
  )

  const hasDragFiles = useCallback((e: React.DragEvent<HTMLDivElement>): boolean => {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files')
  }, [])

  // 拖拽外部文件进入树：仅在拖的是文件时给高亮反馈
  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(e)) return
      e.preventDefault()
      dragDepthRef.current += 1
      setDragOver(true)
    },
    [hasDragFiles],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(e)) return
      // 必须 preventDefault 才能让 drop 事件生效
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [hasDragFiles],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!hasDragFiles(e)) return
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDragOver(false)
    },
    [hasDragFiles],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragDepthRef.current = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      const targetDir = resolveDropTargetDir(session.id, selectedPath, e.target as HTMLElement)
      void uploadFiles(files, targetDir)
    },
    [session.id, selectedPath, uploadFiles],
  )

  // 树内选中节点变化时同步（点目录不打开文件，但剪切/删除需要它作为目标）
  const handleTreeSelect = useCallback((node: FileNode | null) => {
    setSelectedNode(node)
  }, [])

  // 树内焦点时的快捷键：Ctrl/Cmd+C/X + Delete/Backspace + Escape 取消剪切；
  // 粘贴统一走 onPaste（内部/外部文件）
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'c') {
        e.preventDefault()
        void handleClipboardAction('copy')
      } else if (mod && key === 'x') {
        e.preventDefault()
        void handleClipboardAction('cut')
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Backspace 需 preventDefault 阻止浏览器后退导航
        e.preventDefault()
        if (!selectedNode) return
        setMutation({ type: 'delete', node: selectedNode })
      } else if (e.key === 'Escape') {
        if (useClipboardStore.getState().mode === 'cut') {
          useClipboardStore.getState().clearClipboard()
          toast.success('已取消剪切')
        }
      }
    },
    [handleClipboardAction, selectedNode],
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
            <div
              ref={treeContainerRef}
              tabIndex={-1}
              className={cn('min-h-0 flex-1', dragOver && 'ring-2 ring-inset ring-accent/70')}
              onKeyDown={handleTreeKeyDown}
              onPaste={handleTreePaste}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <ArboristFileTree
                sessionId={session.id}
                rootName={getRootFolderName(session.worktreePath)}
                selectedPath={selectedPath}
                onOpenFile={handleOpenFile}
                onSelect={handleTreeSelect}
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
            onClipboardAction={handleClipboardAction}
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
