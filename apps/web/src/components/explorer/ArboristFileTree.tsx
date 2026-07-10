import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps, TreeApi } from 'react-arborist'
import { Folder, FolderOpen, File, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@akari/shared-types'
import { getFileTreeChildren, fetchFileTreeChildren, useFileTreeChildren, useFileTreeTick } from '@/lib/file-tree-store'

const ROOT_ID = '__root__'

interface ArboristFileNode {
  id: string
  path: string
  name: string
  type: 'file' | 'directory'
  children?: ArboristFileNode[]
}

function idToPath(id: string): string {
  return id === ROOT_ID ? '' : id
}

function pathToId(path: string): string {
  return path === '' ? ROOT_ID : path
}

function isLoaded(sessionId: string, path: string): boolean {
  return getFileTreeChildren(sessionId, path) !== undefined
}

interface ArboristFileTreeProps {
  sessionId: string
  rootName: string
  selectedPath?: string
  onOpenFile: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, node: FileNode) => void
  onRefresh?: () => void
  isRefreshing?: boolean
}

function buildNode(fileNode: FileNode, sessionId: string): ArboristFileNode {
  const children = fileNode.type === 'directory' ? getFileTreeChildren(sessionId, fileNode.path) : undefined
  const childNodes = children?.map(child => buildNode(child, sessionId)) ?? []

  // 压缩中间单目录链：只有一个子目录时合并显示
  // id 保持父路径，让 Tree 的展开状态连续；path 用子路径，用于懒加载和右键菜单
  if (fileNode.type === 'directory' && childNodes.length === 1 && childNodes[0]!.type === 'directory') {
    const compressed = childNodes[0]!
    return {
      id: pathToId(fileNode.path),
      path: compressed.path,
      name: `${fileNode.name}/${compressed.name}`,
      type: 'directory',
      children: compressed.children,
    }
  }

  return {
    id: pathToId(fileNode.path),
    path: fileNode.path,
    name: fileNode.name,
    type: fileNode.type,
    children: fileNode.type === 'directory' ? childNodes : undefined,
  }
}

function NodeRenderer({
  node,
  style,
  onOpenFile,
  onContextMenu,
}: NodeRendererProps<ArboristFileNode> & {
  onOpenFile: (path: string) => void
  onContextMenu?: (e: React.MouseEvent, node: FileNode) => void
}) {
  const isDirectory = node.data.type === 'directory'
  const isSelected = node.isSelected

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    node.select()
    onContextMenu?.(e, {
      name: node.data.name,
      path: node.data.path,
      type: node.data.type,
    })
  }, [node, onContextMenu])

  const handleClick = useCallback(() => {
    node.select()
    if (node.data.type === 'file') {
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
      style={style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={cn(
        'flex cursor-pointer items-center gap-1 py-[3px] pr-2 text-[12px] select-none',
        isSelected ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      {isDirectory ? (
        <>
          <span
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
            onClick={handleToggleClick}
          >
            {node.isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
          {node.isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
          )}
        </>
      ) : (
        <>
          <span className="h-3.5 w-3.5 shrink-0" />
          <File className="h-3.5 w-3.5 shrink-0 text-blue-400/70" />
        </>
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
  onContextMenu,
  onRefresh,
  isRefreshing,
}: ArboristFileTreeProps) {
  const rootChildren = useFileTreeChildren(sessionId, '')
  const treeTick = useFileTreeTick()
  const containerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<TreeApi<ArboristFileNode> | undefined>(undefined)
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

  const treeData = useMemo(() => {
    if (!rootChildren) return []
    const root: ArboristFileNode = {
      id: ROOT_ID,
      path: '',
      name: rootName,
      type: 'directory',
      children: rootChildren.map(child => buildNode(child, sessionId)),
    }
    return [root]
  }, [rootChildren, sessionId, rootName, treeTick])

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
    const path = node?.data.path ?? idToPath(id)
    if (isLoaded(sessionId, path)) return
    loadChain(path).catch(err => {
      console.error(`[ArboristFileTree] lazy load chain failed path="${path}"`, err)
    })
  }, [sessionId, loadChain])

  const CustomNodeRenderer = useCallback((props: NodeRendererProps<ArboristFileNode>) => (
    <NodeRenderer {...props} onOpenFile={onOpenFile} onContextMenu={onContextMenu} />
  ), [onOpenFile, onContextMenu])

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">文件</span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="刷新"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <Tree
          ref={treeRef}
          data={treeData}
          height={height}
          width="100%"
          rowHeight={24}
          indent={12}
          openByDefault={false}
          initialOpenState={{ [ROOT_ID]: true }}
          selection={selectedPath}
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
