import { useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Folder, File, ChevronUp, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FsEntry } from '@akari/shared-types'

interface FileBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
}

export function FileBrowserDialog({ open, onOpenChange, onSelect }: FileBrowserDialogProps) {
  const {
    fileBrowserPath,
    fileBrowserEntries,
    fileBrowserSelectedPath,
    fileBrowserLoading,
    navigateTo,
    selectPath,
    goUp,
    closeFileBrowser,
  } = useWorkspaceStore()

  useEffect(() => {
    if (open) {
      navigateTo('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleDoubleClick = (entry: FsEntry) => {
    if (entry.type === 'directory') {
      navigateTo(entry.path)
      selectPath(null)
    }
  }

  const handleSelect = () => {
    if (fileBrowserSelectedPath) {
      onSelect(fileBrowserSelectedPath)
      closeFileBrowser()
    }
  }

  // Build breadcrumb from current path
  const buildBreadcrumb = () => {
    if (!fileBrowserPath) {
      return [{ label: '此电脑', path: '' }]
    }
    const normalized = fileBrowserPath.replace(/\\/g, '/')
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
  const isAtRoot = !fileBrowserPath

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[500px] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="text-base">选择工作区文件夹</DialogTitle>
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
          {fileBrowserLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              加载中...
            </div>
          ) : fileBrowserEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              空文件夹
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {fileBrowserEntries.map((entry) => (
                <button
                  key={entry.path}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded text-sm text-left transition-colors',
                    fileBrowserSelectedPath === entry.path
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent',
                  )}
                  onClick={() => selectPath(entry.path)}
                  onDoubleClick={() => handleDoubleClick(entry)}
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
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 gap-3">
          <div className="text-sm text-muted-foreground truncate flex-1 min-w-0">
            {fileBrowserSelectedPath || '请选择一个文件夹'}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleSelect} disabled={!fileBrowserSelectedPath}>
              选择
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
