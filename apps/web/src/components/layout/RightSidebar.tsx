import { GitBranch, FileCode, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { GitGraphPanel } from '@/components/git/GitGraphPanel'
import { DiffFileList } from '@/components/diff/DiffFileList'
import { SessionInfoPanel } from '@/components/session/SessionInfoPanel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const TABS: { id: 'git-graph' | 'diff' | 'info'; label: string; icon: React.ElementType }[] = [
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'diff', label: '变更', icon: FileCode },
  { id: 'info', label: '信息', icon: Info },
]

interface RightSidebarProps {
  session?: AgentSession
}

export function RightSidebar({ session }: RightSidebarProps) {
  const activeRightTab = useSessionStore(s => s.activeRightTab)
  const selectedDiffFile = useSessionStore(s => s.selectedDiffFile)
  const setActiveRightTab = useSessionStore(s => s.setActiveRightTab)
  const setSelectedDiffFile = useSessionStore(s => s.setSelectedDiffFile)

  const handleSelectFile = (path: string) => {
    setSelectedDiffFile(path)
  }

  return (
    <div className="flex h-full w-full flex-col bg-panel">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-1 gap-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  setActiveRightTab(id)
                  if (id !== 'diff') setSelectedDiffFile(null)
                }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded transition-colors',
                  activeRightTab === id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        {session ? (
          <>
            <div className={cn('absolute inset-0', activeRightTab !== 'git-graph' && 'hidden')}>
              <GitGraphPanel sessionId={session.id} />
            </div>
            <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'diff' && 'hidden')}>
              <DiffFileList
                session={session}
                selectedFile={selectedDiffFile}
                onSelectFile={handleSelectFile}
              />
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
