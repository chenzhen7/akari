import { GitBranch, FileCode, Info, FolderTree } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { useSessionStore } from '@/features/session/stores/session-store'
import { useUIStore } from '@/shared/stores/ui-store'
import { useTabStore } from '@/features/session/stores/tab-store'
import { GitGraphPanel } from '@/features/git/components/GitGraphPanel'
import { DiffFileList } from '@/features/diff/components/DiffFileList'
import { SessionInfoPanel } from '@/features/session/components/SessionInfoPanel'
import { ExplorerPanel } from '@/features/explorer/components/ExplorerPanel'
import { Button } from '@/shared/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip'
import { useShallow } from 'zustand/react/shallow'

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
  const selectSession = useSessionStore(s => s.selectSession)
  const createTab = useTabStore(s => s.createTab)
  const activateTab = useTabStore(s => s.activateTab)
  const session = useSessionStore(
    useShallow(s => sessionId ? s.sessions.find(ses => ses.id === sessionId) : undefined),
  )
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
    <div className="flex h-full w-full flex-col border-t border-border bg-[var(--terminal-background)]">
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
                  'hover:bg-zinc-200 dark:hover:bg-zinc-800',
                  activeRightTab === id
                    ? 'bg-zinc-200 text-foreground dark:bg-zinc-700'
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
