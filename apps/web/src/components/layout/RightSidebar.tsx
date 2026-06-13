import { GitBranch, FileCode, Info, FolderTree } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { GitGraphPanel } from '@/components/git/GitGraphPanel'
import { DiffFileList } from '@/components/diff/DiffFileList'
import { SessionInfoPanel } from '@/components/session/SessionInfoPanel'
import { ExplorerPanel } from '@/components/explorer/ExplorerPanel'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const TABS: { id: 'git-graph' | 'diff' | 'info' | 'explorer'; label: string; icon: React.ElementType }[] = [
  { id: 'explorer', label: '文件', icon: FolderTree },
  { id: 'diff', label: '变更', icon: FileCode },
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'info', label: '信息', icon: Info },
]

interface RightSidebarProps {
  session?: AgentSession
}

export function RightSidebar({ session }: RightSidebarProps) {
  const activeRightTab = useSessionStore(s => s.activeRightTab)
  const setActiveRightTab = useSessionStore(s => s.setActiveRightTab)
  const selectSession = useSessionStore(s => s.selectSession)
  const createTab = useSessionStore(s => s.createTab)
  const activateTab = useSessionStore(s => s.activateTab)

  const handleSelectFile = (path: string) => {
    if (!session) return
    // Select the session first (ensures middle area shows this session's tab bar)
    selectSession(session.id)
    // Check if a diff tab for this file already exists
    const existingTab = session.tabs.find(t => t.type === 'diff' && t.filePath === path)
    if (existingTab) {
      activateTab(session.id, existingTab.id)
    } else {
      createTab(session.id, 'diff', path)
    }
  }

  const handleOpenFile = (path: string) => {
    if (!session) return
    // Select the session first
    selectSession(session.id)
    // Check if a file tab for this file already exists
    const existingTab = session.tabs.find(t => t.type === 'file' && t.filePath === path)
    if (existingTab) {
      activateTab(session.id, existingTab.id)
    } else {
      createTab(session.id, 'file', path)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-panel">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-1 gap-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setActiveRightTab(id)}
                className={cn(
                  'rounded',
                  activeRightTab === id
                    ? 'bg-muted/50 text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        {session ? (
          <>
            <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'explorer' && 'hidden')}>
              <ExplorerPanel session={session} onOpenFile={handleOpenFile} />
            </div>
            <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'diff' && 'hidden')}>
              <DiffFileList session={session} onSelectFile={handleSelectFile} />
            </div>
            <div className={cn('absolute inset-0', activeRightTab !== 'git-graph' && 'hidden')}>
              <GitGraphPanel sessionId={session.id} />
            </div>
            <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'info' && 'hidden')}>
              <SessionInfoPanel session={session} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-xs">请选择一个会话以查看详情</p>
          </div>
        )}
      </div>
    </div>
  )
}
