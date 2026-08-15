import { GitBranch, FileCode, Info, FolderTree } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { useSessionById } from '@/features/session/stores/session-store'
import { useNavigationStore } from '@/shared/stores/navigation-store'
import { useUIStore } from '@/shared/stores/ui-store'
import { useTabStore } from '@/features/session/stores/tab-store'
import { useDiffReviewStore } from '@/features/diff/stores/diff-review-store'
import { GitGraphPanel } from '@/features/git/components/GitGraphPanel'
import { DiffFileList } from '@/features/diff/components/DiffFileList'
import { SessionInfoPanel } from '@/features/session/components/SessionInfoPanel'
import { ExplorerPanel } from '@/features/explorer/components/ExplorerPanel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip'

type RightTabId = 'git-graph' | 'diff' | 'info' | 'explorer'

const TABS: { id: RightTabId; label: string; icon: React.ElementType }[] = [
  { id: 'explorer', label: '文件', icon: FolderTree },
  { id: 'diff', label: '变更', icon: FileCode },
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'info', label: '信息', icon: Info },
]

interface RightSidebarProps {
  sessionId?: string
}

export function RightSidebar({ sessionId }: RightSidebarProps) {
  const activeRightTab = useUIStore(s => s.activeRightTab)
  const setActiveRightTab = useUIStore(s => s.setActiveRightTab)
  const selectSession = useNavigationStore(s => s.selectSession)
  const createTab = useTabStore(s => s.createTab)
  const activateTab = useTabStore(s => s.activateTab)
  const session = useSessionById(sessionId)
  const sessionKey = session?.id ?? '__empty__'
  const sessionKeyRef = useRef(sessionKey)
  const [mountedPanels, setMountedPanels] = useState<Set<RightTabId>>(() => new Set([activeRightTab]))

  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey
      setMountedPanels(new Set([activeRightTab]))
      return
    }

    setMountedPanels(prev => {
      if (prev.has(activeRightTab)) return prev
      return new Set([...prev, activeRightTab])
    })
  }, [activeRightTab, sessionKey])

  const shouldRenderPanel = (id: RightTabId): boolean => activeRightTab === id || mountedPanels.has(id)

  const setScrollTarget = useDiffReviewStore(s => s.setScrollTarget)

  const handleSelectFile = (path: string) => {
    if (!session) return
    // Select the session first (ensures middle area shows this session's tab bar)
    selectSession(session.id)
    // Always set the scroll target so the review page scrolls to this file
    setScrollTarget(session.id, path)
    // Check if a review tab already exists
    const existingTab = session.tabs.find(t => t.type === 'review')
    if (existingTab) {
      activateTab(session.id, existingTab.id)
    } else {
      createTab(session.id, 'review')
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
    <div className="flex h-full w-full flex-col border-t border-border bg-[var(--terminal-background)]">
      {/* Tab bar：分段控件样式 */}
      <div className="flex h-10 shrink-0 items-center px-2">
        <div className="flex gap-0.5 rounded-lg bg-zinc-500/10 p-0.5 dark:bg-zinc-400/10">
          {TABS.map(({ id, label, icon: Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveRightTab(id)}
                  className={cn(
                    'flex h-6 w-8 items-center justify-center rounded-md transition-colors',
                    activeRightTab === id
                      ? 'bg-white text-foreground shadow-sm dark:bg-zinc-700'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Content: keep-alive with display:none so panels don't remount on tab switch */}
      <div className="relative flex-1 overflow-hidden">
        {session ? (
          <>
            {shouldRenderPanel('explorer') && (
              <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'explorer' && 'hidden')}>
                <ExplorerPanel session={session} onOpenFile={handleOpenFile} />
              </div>
            )}
            {shouldRenderPanel('diff') && (
              <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'diff' && 'hidden')}>
                <DiffFileList
                  session={session}
                  onSelectFile={handleSelectFile}
                  onOpenFile={handleOpenFile}
                />
              </div>
            )}
            {shouldRenderPanel('git-graph') && (
              <div className={cn('absolute inset-0', activeRightTab !== 'git-graph' && 'hidden')}>
                <GitGraphPanel sessionId={session.id} />
              </div>
            )}
            {shouldRenderPanel('info') && (
              <div className={cn('absolute inset-0 overflow-hidden', activeRightTab !== 'info' && 'hidden')}>
                <SessionInfoPanel session={session} />
              </div>
            )}
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
