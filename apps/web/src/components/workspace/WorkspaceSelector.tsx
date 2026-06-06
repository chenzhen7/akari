import { useState, useCallback } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { FileBrowserDialog } from './FileBrowserDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Check, FolderOpen, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function WorkspaceSelector() {
  const {
    workspaces,
    currentWorkspace,
    switchWorkspace,
    addWorkspace,
  } = useWorkspaceStore()

  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)

  const handleSelectPath = useCallback((path: string) => {
    // Derive name from path
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    const name = parts[parts.length - 1] || 'workspace'
    addWorkspace(name, path)
    setFileBrowserOpen(false)
  }, [addWorkspace])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs font-normal max-w-[200px]"
          >
            <span className="truncate">
              {currentWorkspace?.name ?? '选择工作区'}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {/* Current workspace */}
          {currentWorkspace && (
            <>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">当前工作区</div>
              <DropdownMenuItem
                className="flex items-center gap-2 text-sm"
                disabled
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{currentWorkspace.name}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Other workspaces */}
          {workspaces.filter(w => w.id !== currentWorkspace?.id).length > 0 && (
            <>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">最近打开</div>
              {workspaces
                .filter(w => w.id !== currentWorkspace?.id)
                .map(workspace => (
                  <DropdownMenuItem
                    key={workspace.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    onClick={() => switchWorkspace(workspace.id)}
                  >
                    <span className="w-3.5 shrink-0" />
                    <span className="truncate">{workspace.name}</span>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
            </>
          )}

          {/* Open folder */}
          <DropdownMenuItem
            className="flex items-center gap-2 text-sm cursor-pointer"
            onClick={() => setFileBrowserOpen(true)}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span>打开文件夹...</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <FileBrowserDialog
        open={fileBrowserOpen}
        onOpenChange={setFileBrowserOpen}
        onSelect={handleSelectPath}
      />
    </>
  )
}
