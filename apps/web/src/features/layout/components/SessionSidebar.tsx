import { useCallback } from 'react'
import { cn } from '@/shared/lib/utils'
import { useSessionStore } from '@/features/session/stores/session-store'
import { useUIStore } from '@/shared/stores/ui-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { selectFolder } from '@/shared/lib/native-file-picker'
import { toastError } from '@/shared/lib/toast'
import { CANVAS_ENABLED } from '@/shared/lib/feature-flags'
import { Button } from '@/shared/components/ui/button'
import {
  FolderOpen,
  LayoutGrid,
  Columns3,
  Radio,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { SettingsDialog } from '@/features/settings/components/SettingsDialog'
import { WorkspaceSessionList } from '@/features/workspace/components/WorkspaceSessionList'
import { shortcutLabel } from '@/shared/lib/shortcuts'

interface SidebarActionButtonProps {
  icon: LucideIcon
  label: string
  active?: boolean
  shortcut?: string
  disabled?: boolean
  title?: string
  onClick: () => void
}

function SidebarActionButton({ icon: Icon, label, active, shortcut, disabled, title, onClick }: SidebarActionButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-8 w-full justify-between rounded-lg px-2.5 text-sm font-normal transition-none',
        active
          ? 'bg-zinc-200 text-zinc-900 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-100'
          : 'text-foreground hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      {shortcut && (
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-sans text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Button>
  )
}

function SidebarActions() {
  const globalViewMode = useSessionStore(s => s.globalViewMode)
  const setGlobalViewMode = useSessionStore(s => s.setGlobalViewMode)
  const toggleCommandCenter = useUIStore(s => s.toggleCommandCenter)
  const addWorkspace = useWorkspaceStore(s => s.addWorkspace)
  const activateWorkspace = useWorkspaceStore(s => s.activateWorkspace)

  const handleOpenFolder = useCallback(async () => {
    try {
      const path = await selectFolder()
      if (!path) return
      const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
      const name = parts[parts.length - 1] || 'workspace'
      const workspace = await addWorkspace(name, path)
      if (workspace) {
        await activateWorkspace(workspace.id)
      }
    } catch (err) {
      toastError(`打开文件夹失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [addWorkspace, activateWorkspace])

  const canOpenFolder = typeof window !== 'undefined' && !!window.electron?.dialog?.showOpenDialog

  return (
    <div className="space-y-0.5 border-b border-border/50 p-2">
      {canOpenFolder && (
        <SidebarActionButton
          icon={FolderOpen}
          label="打开文件夹"
          onClick={() => void handleOpenFolder()}
        />
      )}
      {CANVAS_ENABLED && (
        <SidebarActionButton
          icon={LayoutGrid}
          label="画布"
          active={globalViewMode === 'canvas'}
          onClick={() => setGlobalViewMode('canvas')}
        />
      )}
      <SidebarActionButton
        icon={Columns3}
        label="看板"
        active={globalViewMode === 'kanban'}
        shortcut={shortcutLabel('kanban')}
        onClick={() => setGlobalViewMode('kanban')}
      />
      <SidebarActionButton
        icon={Radio}
        label="指挥中心"
        shortcut={shortcutLabel('command-center')}
        onClick={toggleCommandCenter}
      />
    </div>
  )
}

export function SessionSidebar() {
  const settingsOpen = useUIStore(s => s.settingsOpen)
  const setSettingsOpen = useUIStore(s => s.setSettingsOpen)

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-panel">
        <div className="flex h-full w-full flex-col">
          <SidebarActions />

          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspaceSessionList />
          </div>

          <div className="shrink-0 border-t border-border/50 p-2">
            <SidebarActionButton
              icon={Settings}
              label="设置"
              shortcut={shortcutLabel('settings')}
              onClick={() => setSettingsOpen(true)}
            />
          </div>
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}
