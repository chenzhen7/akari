import { useState, useCallback, type ReactNode } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@akari/shared-types'
import { useFileTreeChildren } from '@/lib/file-tree-store'

interface FileTreeNodeProps {
  sessionId: string
  node: FileNode
  level: number
  selectedPath?: string
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => Promise<void>
  defaultExpanded?: boolean
  actions?: ReactNode
}

export function FileTreeNode({
  sessionId,
  node,
  level,
  selectedPath,
  onSelectFile,
  onToggleDir,
  defaultExpanded = false,
  actions,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loading, setLoading] = useState(false)
  const isDirectory = node.type === 'directory'
  const isSelected = selectedPath === node.path
  const children = useFileTreeChildren(sessionId, node.path)

  const handleToggle = useCallback(async () => {
    if (!isDirectory) {
      onSelectFile(node.path)
      return
    }

    if (expanded) {
      setExpanded(false)
      return
    }

    if (children === undefined) {
      setLoading(true)
      try {
        await onToggleDir(node.path)
      } finally {
        setLoading(false)
      }
    }
    setExpanded(true)
  }, [isDirectory, expanded, children, node.path, onSelectFile, onToggleDir])

  return (
    <div>
      <div
        className={cn(
          'flex cursor-pointer items-center gap-1 py-[3px] pr-2 text-[12px] select-none',
          isSelected ? 'bg-muted/70 text-foreground' : 'text-muted-foreground hover:bg-muted/50',
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={handleToggle}
      >
        {isDirectory ? (
          <>
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {loading ? (
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              ) : expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </span>
            {expanded ? (
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
        <span className={cn('truncate', isSelected && 'font-medium text-foreground')}>{node.name}</span>
        {actions && (
          <span
            className="ml-auto flex items-center"
            onClick={e => e.stopPropagation()}
          >
            {actions}
          </span>
        )}
      </div>

      {isDirectory && expanded && children !== undefined && (
        <div>
          {children.map(child => (
            <FileTreeNode
              key={child.path}
              sessionId={sessionId}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
            />
          ))}
        </div>
      )}
    </div>
  )
}
