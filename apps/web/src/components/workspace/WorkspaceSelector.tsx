import { useCallback } from 'react'
import { toastError } from '@/lib/toast'
import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Check, FolderOpen, ChevronDown } from 'lucide-react'
import { selectFolder } from '@/lib/native-file-picker'

function openWorkspaceWindow(workspaceId: string): void {
  if (window.electron?.workspace?.openWindow) {
    void window.electron.workspace.openWindow(workspaceId)
    return
  }
  // Fallback for non-desktop builds: switch in the current window
  useWorkspaceStore.getState().switchWorkspace(workspaceId)
}

export function WorkspaceSelector() {
  const {
    workspaces,
    currentWorkspace,
    switchWorkspace,
    addWorkspace,
  } = useWorkspaceStore()

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await selectFolder()
      if (!path) return
      const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
      const name = parts[parts.length - 1] || 'workspace'
      const workspace = await addWorkspace(name, path)
      if (workspace) {
        openWorkspaceWindow(workspace.id)
      } else {
        toastError('该路径的工作区已存在')
      }
    } catch (err) {
      toastError(`打开文件夹失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [addWorkspace])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    if (workspaceId === currentWorkspace?.id) return
    openWorkspaceWindow(workspaceId)
  }, [currentWorkspace?.id])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-between rounded-lg px-2.5 text-sm font-normal text-foreground hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 transition-none"
        >
          <div className="flex items-center gap-3 min-w-0">
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {currentWorkspace?.name ?? '选择工作区'}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {/* Current workspace */}
        {currentWorkspace && (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground">当前工作区</div>
            <DropdownMenuItem
              className="flex items-center gap-2 text-sm"
              onSelect={e => e.preventDefault()}
              title={`${currentWorkspace.name}\n${currentWorkspace.path}`}
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="flex flex-col min-w-0">
                <span className="truncate">{currentWorkspace.name}</span>
                <span className="truncate text-xs text-muted-foreground" title={currentWorkspace.path}>{currentWorkspace.path}</span>
              </div>
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
                  onClick={() => handleSelectWorkspace(workspace.id)}
                  title={`${workspace.name}\n${workspace.path}`}
                >
                  <span className="w-3.5 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{workspace.name}</span>
                    <span className="truncate text-xs text-muted-foreground" title={workspace.path}>{workspace.path}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Open folder */}
        <DropdownMenuItem
          className="flex items-center gap-2 text-sm cursor-pointer"
          onClick={handleOpenFolder}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span>打开文件夹...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
