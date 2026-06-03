import { useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileNode } from '@akari/shared-types'

interface FileTreeNodeProps {
  node: FileNode
  level: number
  selectedPath?: string
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => Promise<FileNode[]>
  childrenCache: Map<string, FileNode[]>
}

export function FileTreeNode({
  node,
  level,
  selectedPath,
  onSelectFile,
  onToggleDir,
  childrenCache,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const isDirectory = node.type === 'directory'
  const isSelected = selectedPath === node.path
  const children = childrenCache.get(node.path)

  const handleToggle = useCallback(async () => {
    if (!isDirectory) {
      onSelectFile(node.path)
      return
    }

    if (expanded) {
      setExpanded(false)
      return
    }

    if (!children) {
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
      </div>

      {isDirectory && expanded && children && (
        <div>
          {children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              onToggleDir={onToggleDir}
              childrenCache={childrenCache}
            />
          ))}
        </div>
      )}
    </div>
  )
}
