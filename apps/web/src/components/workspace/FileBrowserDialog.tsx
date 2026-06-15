import { useEffect, useCallback, useState, memo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Folder, File, ChevronUp, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { API_BASE } from '@/lib/api'
import type { FsEntry } from '@akari/shared-types'

interface FileBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
}

interface FileBrowserItemProps {
  entry: FsEntry
  isSelected: boolean
  isAtRoot: boolean
  onSelect: (path: string) => void
  onNavigate: (path: string) => void
}

const FileBrowserItem = memo(function FileBrowserItem({
  entry,
  isSelected,
  isAtRoot,
  onSelect,
  onNavigate,
}: FileBrowserItemProps) {
  const handleClick = useCallback(() => onSelect(entry.path), [onSelect, entry.path])
  const handleDoubleClick = useCallback(() => {
    if (entry.type === 'directory') {
      onNavigate(entry.path)
    }
  }, [onNavigate, entry])

  return (
    <button
      key={entry.path}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded text-sm text-left transition-colors',
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-accent',
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {entry.type === 'directory' ? (
        isAtRoot ? (
          <HardDrive className="h-4 w-4 text-blue-400 shrink-0" />
        ) : (
          <Folder className="h-4 w-4 text-blue-400 shrink-0" />
        )
      ) : (
        <File className="h-4 w-4 text-muted-foreground shrink-0" />
      )}
      <span className="truncate">{entry.name}</span>
    </button>
  )
})

export function FileBrowserDialog({ open, onOpenChange, onSelect }: FileBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const navigateTo = useCallback((path: string) => {
    setLoading(true)
    setCurrentPath(path)
    const url = path
      ? `${API_BASE}/fs/list?path=${encodeURIComponent(path)}`
      : `${API_BASE}/fs/list`
    fetch(url)
      .then(r => r.json())
      .then((data: { entries: FsEntry[]; currentPath: string; parentPath: string | null }) => {
        setEntries(data.entries)
        setCurrentPath(data.currentPath)
        setLoading(false)
      })
      .catch(err => {
        console.error('[FileBrowserDialog] navigateTo failed:', err)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (open) {
      navigateTo('')
      setSelectedPath(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSelect = () => {
    if (selectedPath) {
      onSelect(selectedPath)
      onOpenChange(false)
    }
  }

  const handleItemSelect = useCallback((path: string) => setSelectedPath(path), [])
  const handleItemNavigate = useCallback((path: string) => {
    navigateTo(path)
    setSelectedPath(null)
  }, [navigateTo])

  const goUp = () => {
    if (!currentPath) return
    const normalized = currentPath.replace(/\\/g, '/')
    if (/^[A-Za-z]:\/?$/.test(normalized)) {
      navigateTo('')
      return
    }
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) {
      navigateTo('')
      return
    }
    const parent = normalized.slice(0, lastSlash)
    if (/^[A-Za-z]:$/.test(parent)) {
      navigateTo(parent + '/')
      return
    }
    navigateTo(parent || '/')
  }

  const buildBreadcrumb = () => {
    if (!currentPath) {
      return [{ label: '此电脑', path: '' }]
    }
    const normalized = currentPath.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    const crumbs: { label: string; path: string }[] = [{ label: '此电脑', path: '' }]
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      crumbs.push({ label: part, path: acc })
    }
    return crumbs
  }

  const breadcrumb = buildBreadcrumb()
  const isAtRoot = !currentPath

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[500px] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="text-base">选择文件夹</DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
          <Button
            variant="ghost"
            size="xs"
            className="h-7 w-7 p-0"
            onClick={goUp}
            disabled={isAtRoot}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1 text-sm overflow-hidden flex-1">
            {breadcrumb.map((crumb, i) => (
              <span key={i} className="flex items-center shrink-0">
                {i > 0 && <span className="text-muted-foreground mx-1">/</span>}
                <button
                  className="hover:text-primary hover:underline truncate max-w-[120px]"
                  onClick={() => navigateTo(crumb.path)}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-1 py-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              加载中...
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              空文件夹
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {entries.map((entry) => (
                <FileBrowserItem
                  key={entry.path}
                  entry={entry}
                  isSelected={selectedPath === entry.path}
                  isAtRoot={isAtRoot}
                  onSelect={handleItemSelect}
                  onNavigate={handleItemNavigate}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 gap-3">
          <div className="text-sm text-muted-foreground truncate flex-1 min-w-0">
            {selectedPath || '请选择一个文件夹'}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSelect} disabled={!selectedPath}>
              选择
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
