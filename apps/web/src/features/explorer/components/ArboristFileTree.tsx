import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import { RefreshCw, ChevronRight, ChevronDown, Plus, FilePlus, FolderPlus } from 'lucide-react'
import { FileTypeIcon } from '@/shared/components/file-icon'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import type { FileNode } from '@akari/shared-types'
import { getFileTreeChildren, fetchFileTreeChildren, useFileTreeChildren, useFileTreeTick } from '@/features/explorer/lib/file-tree-store'
import { useClipboardStore } from '@/features/explorer/stores/clipboard-store'
import { perfMark } from '@/shared/lib/perf-log'

interface ArboristFileNode {
  id: string
  path: string
  name: string
  type: 'file' | 'directory'
  children?: ArboristFileNode[]
}

function isLoaded(sessionId: string, path: string): boolean {
  return getFileTreeChildren(sessionId, path) !== undefined
}

interface ArboristFileTreeProps {
  sessionId: string
  rootName: string
  selectedPath?: string
  onOpenFile: (path: string) => void
  /** 树内选中节点变化时回调（用于剪切/删除等快捷键定位目标） */
  onSelect?: (node: FileNode | null) => void
  onRefresh?: () => void
  isRefreshing?: boolean
  onCreateFile?: (parentPath: string) => void
  onCreateFolder?: (parentPath: string) => void
}

function buildNode(fileNode: FileNode, sessionId: string): ArboristFileNode {
  const children = fileNode.type === 'directory' ? getFileTreeChildren(sessionId, fileNode.path) : undefined
  const childNodes = children?.map(child => buildNode(child, sessionId)) ?? []

  // 压缩中间单目录链：只有一个子目录时合并显示
  // id 保持父路径，让 Tree 的展开状态连续；path 用子路径，用于懒加载和右键菜单
  if (fileNode.type === 'directory' && childNodes.length === 1 && childNodes[0]!.type === 'directory') {
    const compressed = childNodes[0]!
    return {
      id: fileNode.path,
      path: compressed.path,
      name: `${fileNode.name}/${compressed.name}`,
      type: 'directory',
      children: compressed.children,
    }
  }

  return {
    id: fileNode.path,
    path: fileNode.path,
    name: fileNode.name,
    type: fileNode.type,
    children: fileNode.type === 'directory' ? childNodes : undefined,
  }
}

function NodeRenderer({
  node,
  style,
  sessionId,
  onOpenFile,
}: NodeRendererProps<ArboristFileNode> & {
  sessionId: string
  onOpenFile: (path: string) => void
}) {
  const isDirectory = node.data.type === 'directory'
  const isSelected = node.isSelected
  const isCut = useClipboardStore(
    s => s.mode === 'cut' && s.sessionId === sessionId && s.items.some(it => it.path === node.data.path),
  )

  // 不阻止冒泡、不 preventDefault：若 preventDefault，Radix 的
  // composeEventHandlers 会因 defaultPrevented 跳过打开逻辑，导致菜单打不开。
  // 原生菜单的抑制交给外层 ContextMenuTrigger（其内部会 preventDefault）。
  const handleContextMenu = useCallback(() => {
    node.select()
  }, [node])

  const handleClick = useCallback(() => {
    node.select()
    if (node.data.type === 'file') {
      perfMark(`file:${node.data.path}`, `点击文件 ${node.data.path}`)
      onOpenFile(node.data.path)
    } else {
      node.toggle()
    }
  }, [node, onOpenFile])

  const handleToggleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    node.toggle()
  }, [node])

  return (
    <div
      // paddingLeft 在 arborist 的缩进基础上额外 +4px，让 hover/选中的高亮左边留一点空隙（右侧已有 pr-2）
      style={{ ...style, paddingLeft: Number(style.paddingLeft ?? 0) + 4 }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      data-path={node.data.path}
      data-type={node.data.type}
      className={cn(
        'flex cursor-pointer items-center gap-1 rounded-md border py-0.5 pr-2 text-xs select-none',
        isSelected
          ? 'border-accent/50 bg-accent/50 text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/60',
        isCut && 'opacity-50',
      )}
    >
      {isDirectory ? (
        <span
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
          onClick={handleToggleClick}
        >
          {node.isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>
      ) : (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          <FileTypeIcon fileName={node.data.name} />
        </span>
      )}
      <span className={cn('truncate', isSelected && 'font-medium text-foreground')}>
        {node.data.name}
      </span>
    </div>
  )
}

export function ArboristFileTree({
  sessionId,
  rootName,
  selectedPath,
  onOpenFile,
  onSelect,
  onRefresh,
  isRefreshing,
  onCreateFile,
  onCreateFolder,
}: ArboristFileTreeProps) {
  const rootChildren = useFileTreeChildren(sessionId, '')
  const treeTick = useFileTreeTick()
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeApi<ArboristFileNode> | undefined>(undefined)
  const lastRevealedRef = useRef<string | undefined>(undefined)
  const [height, setHeight] = useState(400)

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const observer = new ResizeObserver(entries => {
      setHeight(entries[0].contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 当外部指定了选中文件（如中间编辑区激活了某个文件标签）时，
  // 自动加载其所有祖先目录并在树中展开、滚动到该文件。
  useEffect(() => {
    if (!selectedPath) {
      lastRevealedRef.current = undefined
      return
    }
    if (lastRevealedRef.current === selectedPath) return

    const reveal = async () => {
      try {
        const parts = selectedPath.split(/[/\\]/).filter(Boolean)
        const ancestorDirs: string[] = ['']
        let current = ''
        for (let i = 0; i < parts.length - 1; i++) {
          current = current ? `${current}/${parts[i]}` : parts[i]
          ancestorDirs.push(current)
        }

        for (const dir of ancestorDirs) {
          if (!isLoaded(sessionId, dir)) {
            await fetchFileTreeChildren(sessionId, dir)
          }
        }

        // 等待 react-arborist 根据新数据完成一次渲染
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

        const tree = treeRef.current
        if (!tree) return
        tree.openParents(selectedPath)
        tree.select(selectedPath, { align: 'center', focus: false })
        lastRevealedRef.current = selectedPath
      } catch (err) {
        console.error(`[ArboristFileTree] reveal failed for "${selectedPath}":`, err)
      }
    }

    reveal()
  }, [selectedPath, sessionId])

  const treeData = useMemo(
    () => rootChildren?.map(child => buildNode(child, sessionId)) ?? [],
    [rootChildren, sessionId, treeTick],
  )

  const loadChain = useCallback(async (path: string): Promise<void> => {
    if (isLoaded(sessionId, path)) return
    const children = await fetchFileTreeChildren(sessionId, path)
    // 单目录链自动继续展开，直到遇到分支或文件
    if (children.length === 1 && children[0]!.type === 'directory') {
      await loadChain(children[0]!.path)
    }
  }, [sessionId])

  const handleToggle = useCallback((id: string) => {
    const node = treeRef.current?.get(id)
    const path = node?.data.path ?? id
    if (isLoaded(sessionId, path)) return
    loadChain(path).catch(err => {
      console.error(`[ArboristFileTree] lazy load chain failed path="${path}"`, err)
    })
  }, [sessionId, loadChain])

  const CustomNodeRenderer = useCallback((props: NodeRendererProps<ArboristFileNode>) => (
    <NodeRenderer {...props} sessionId={sessionId} onOpenFile={onOpenFile} />
  ), [sessionId, onOpenFile])

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
        <span className="text-xs font-semibold text-muted-foreground">{rootName}</span>
        <div className="flex items-center ">
          {(onCreateFile || onCreateFolder) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="新建"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onCreateFile && (
                  <DropdownMenuItem onSelect={() => onCreateFile('')}>
                    <FilePlus className="h-3.5 w-3.5" />
                    新建文件
                  </DropdownMenuItem>
                )}
                {onCreateFolder && (
                  <DropdownMenuItem onSelect={() => onCreateFolder('')}>
                    <FolderPlus className="h-3.5 w-3.5" />
                    新建文件夹
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onRefresh && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="刷新"
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-2">
        <Tree
          ref={treeRef}
          data={treeData}
          height={height}
          width="100%"
          rowHeight={26}
          indent={12}
          openByDefault={false}
          selection={selectedPath}
          onSelect={nodes => {
            const n = nodes[0]
            onSelect?.(n ? { path: n.data.path, name: n.data.name, type: n.data.type } : null)
          }}
          onToggle={handleToggle}
          childrenAccessor="children"
          idAccessor="id"
          disableDrag
          disableDrop
        >
          {CustomNodeRenderer}
        </Tree>
      </div>
    </div>
  )
}
