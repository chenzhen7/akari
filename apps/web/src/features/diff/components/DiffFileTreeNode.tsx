import { memo } from 'react'
import { ChevronDown, ChevronRight, Copy, FileCode, Trash2 } from 'lucide-react'
import type { DiffFile } from '@akari/shared-types'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/components/ui/context-menu'
import { FileTypeIcon } from '@/shared/components/file-icon'
import { useDiffReviewStore } from '../stores/diff-review-store'

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  status?: DiffFile['status']
  additions?: number
  deletions?: number
  fileCount?: number
  children: FileTreeNode[]
}

export function buildFileTree(files: DiffFile[]): FileTreeNode {
  const root: FileTreeNode = { name: '', path: '', type: 'directory', children: [] }

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/')
    let current = root
    let accumulatedPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
      const isLast = i === parts.length - 1
      let child = current.children.find((c) => c.name === part)

      if (!child) {
        child = {
          name: part,
          path: accumulatedPath,
          type: isLast ? 'file' : 'directory',
          children: [],
        }
        if (isLast) {
          child.status = file.status
          child.additions = file.additions
          child.deletions = file.deletions
        }
        current.children.push(child)
      }
      current = child
    }
  }

  collapseSingleChildDirectories(root)
  computeFileCounts(root)
  return root
}

function collapseSingleChildDirectories(node: FileTreeNode): void {
  if (node.type !== 'directory') return

  for (const child of node.children) {
    collapseSingleChildDirectories(child)
  }

  while (
    node.children.length === 1 &&
    node.children[0]!.type === 'directory'
  ) {
    const onlyChild = node.children[0]!
    node.name = node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name
    node.path = onlyChild.path
    node.children = onlyChild.children
  }
}

function computeFileCounts(node: FileTreeNode): number {
  if (node.type === 'file') {
    node.fileCount = 1
    return 1
  }

  let count = 0
  for (const child of node.children) {
    count += computeFileCounts(child)
  }
  node.fileCount = count
  return count
}

/** 收集目录节点下所有文件路径（用于目录级丢弃） */
function collectFilePaths(node: FileTreeNode): string[] {
  if (node.type === 'file') return [node.path]
  const paths: string[] = []
  for (const child of node.children) {
    paths.push(...collectFilePaths(child))
  }
  return paths
}

function statusBadgeClass(status?: DiffFile['status']): string {
  if (status === 'A') return 'bg-green-500/15 text-green-500'
  if (status === 'D') return 'bg-red-500/15 text-red-500'
  if (status === 'R') return 'bg-blue-500/15 text-blue-400'
  return 'bg-amber-500/15 text-amber-400'
}

interface DiffFileTreeNodeProps {
  sessionId: string
  node: FileTreeNode
  depth?: number
  selectedPath?: string | null
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onSelectFile: (path: string) => void
  onOpenFile: (path: string) => void
  onDiscardFiles: (paths: string[], label: string) => void
  onCopyPath: (path: string) => void
}

export const DiffFileTreeNode = memo(function DiffFileTreeNode({
  sessionId,
  node,
  depth = 0,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelectFile,
  onOpenFile,
  onDiscardFiles,
  onCopyPath,
}: DiffFileTreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isSelected = selectedPath === node.path
  const isDirectory = node.type === 'directory'

  const viewed = useDiffReviewStore((s) => s.getFileViewed(sessionId, node.path))
  const setFileViewed = useDiffReviewStore((s) => s.setFileViewed)

  const row = (
    <div
      className={cn(
        'group mx-1 my-0.5 flex cursor-pointer items-center gap-1 rounded-md border py-0.5 pr-2 transition-colors select-none',
        isSelected
          ? 'border-accent/50 bg-accent/50'
          : 'border-transparent hover:border-border/60 hover:bg-muted/60',
      )}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      title={node.path}
      onClick={() => {
        if (isDirectory) {
          onToggleExpand(node.path)
        } else {
          onSelectFile(node.path)
        }
      }}
    >
      {isDirectory ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="h-5 w-5 shrink-0 text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand(node.path)
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      ) : (
        <>
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center" />
          <FileTypeIcon fileName={node.name} className="shrink-0 text-muted-foreground" />
        </>
      )}

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          isDirectory && 'font-medium text-foreground',
        )}
      >
        {node.name}
      </span>

      {isDirectory && node.fileCount ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
          {node.fileCount}
        </span>
      ) : null}

      {!isDirectory && (
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'rounded px-1 py-px text-[10px] font-medium uppercase tracking-wide',
              statusBadgeClass(node.status),
            )}
          >
            {node.status ?? 'M'}
          </span>

          <div className="flex items-center gap-0.5 font-mono text-[11px] leading-none">
            {(node.additions ?? 0) > 0 && (
              <span className="text-green-500">+{node.additions}</span>
            )}
            {(node.deletions ?? 0) > 0 && (
              <span className="text-red-400">-{node.deletions}</span>
            )}
          </div>

          <label
            className="flex h-5 cursor-pointer items-center px-1"
            onClick={(e) => e.stopPropagation()}
            title={viewed ? '已查看' : '未查看'}
          >
            <Checkbox
              checked={viewed}
              onCheckedChange={() => setFileViewed(sessionId, node.path, !viewed)}
              aria-label={viewed ? '已查看' : '未查看'}
              className="h-4 w-4"
            />
          </label>
        </div>
      )}
    </div>
  )

  const filePaths = isDirectory ? collectFilePaths(node) : [node.path]

  const contextMenu = (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {isDirectory ? (
          <>
            <ContextMenuItem onSelect={() => onToggleExpand(node.path)}>
              {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {isExpanded ? '折叠全部' : '展开全部'}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onCopyPath(node.path)}>
              <Copy className="size-4" />
              复制路径
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDiscardFiles(filePaths, node.path)}>
              <Trash2 className="size-4" />
              丢弃目录内所有变更
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuItem onSelect={() => onOpenFile(node.path)}>
              <FileCode className="size-4" />
              打开文件
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onCopyPath(node.path)}>
              <Copy className="size-4" />
              复制路径
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDiscardFiles(filePaths, node.path)}>
              <Trash2 className="size-4" />
              丢弃此文件变更
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )

  if (!isDirectory) return contextMenu

  return (
    <div>
      {contextMenu}
      {isExpanded && (
        <div>
          {node.children.map((child) => (
            <DiffFileTreeNode
              key={child.path}
              sessionId={sessionId}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelectFile={onSelectFile}
              onOpenFile={onOpenFile}
              onDiscardFiles={onDiscardFiles}
              onCopyPath={onCopyPath}
            />
          ))}
        </div>
      )}
    </div>
  )
})
