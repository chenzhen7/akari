import { memo } from 'react'
import { ChevronDown, ChevronRight, FileIcon, Eye } from 'lucide-react'
import type { DiffFile } from '@akari/shared-types'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { useDiffReviewStore } from '../stores/diff-review-store'

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  status?: DiffFile['status']
  additions?: number
  deletions?: number
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

  return root
}

function statusColor(status?: DiffFile['status']): string {
  if (status === 'A') return 'text-green-500'
  if (status === 'D') return 'text-red-500'
  if (status === 'R') return 'text-blue-400'
  return 'text-amber-400'
}

interface DiffFileTreeNodeProps {
  sessionId: string
  node: FileTreeNode
  depth?: number
  selectedPath?: string | null
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onSelectFile: (path: string) => void
}

export const DiffFileTreeNode = memo(function DiffFileTreeNode({
  sessionId,
  node,
  depth = 0,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelectFile,
}: DiffFileTreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isSelected = selectedPath === node.path
  const isDirectory = node.type === 'directory'

  const viewed = useDiffReviewStore((s) => s.getFileViewed(sessionId, node.path))

  const row = (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-1 py-1 pr-2 transition-colors',
        isSelected ? 'bg-accent/40' : 'hover:bg-muted/50',
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
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
          className="h-4 w-4 shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand(node.path)
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </Button>
      ) : (
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-bold leading-none">
          <FileIcon className={cn('h-3 w-3', statusColor(node.status))} />
        </span>
      )}

      <span className={cn('min-w-0 flex-1 truncate text-[12px]', isDirectory && 'font-medium')} >
        {node.name}
      </span>

      {!isDirectory && (
        <div className="flex shrink-0 items-center gap-1">
          {viewed && <Eye className="h-3 w-3 text-muted-foreground" />}

          <div className="flex items-center gap-0.5 font-mono text-[10px] leading-none">
            {(node.additions ?? 0) > 0 && (
              <span className="text-green-500">+{node.additions}</span>
            )}
            {(node.additions ?? 0) > 0 && (node.deletions ?? 0) > 0 && (
              <span className="text-muted-foreground/50"> </span>
            )}
            {(node.deletions ?? 0) > 0 && (
              <span className="text-red-400">-{node.deletions}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )

  if (!isDirectory) return row

  return (
    <div>
      {row}
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
            />
          ))}
        </div>
      )}
    </div>
  )
})
