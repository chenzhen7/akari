import { useState } from 'react'
import { GitBranch, FileCode, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentSession } from '@/types'
import { GitGraphPanel } from '@/components/git/GitGraphPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { SessionInfoPanel } from '@/components/session/SessionInfoPanel'

type RightPanelTab = 'git-graph' | 'diff' | 'info'

const TABS: { id: RightPanelTab; label: string; icon: React.ElementType }[] = [
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'diff', label: '变更', icon: FileCode },
  { id: 'info', label: '信息', icon: Info },
]

interface RightSidebarProps {
  session: AgentSession
}

export function RightSidebar({ session }: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('git-graph')

  return (
    <div className="flex h-full w-full flex-col bg-card">
      {/* Tab bar */}
      <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        <div className={cn('absolute inset-0', activeTab !== 'git-graph' && 'hidden')}>
          <GitGraphPanel sessionId={session.id} />
        </div>
        <div className={cn('absolute inset-0 overflow-hidden', activeTab !== 'diff' && 'hidden')}>
          <DiffViewer session={session} />
        </div>
        <div className={cn('absolute inset-0 overflow-hidden', activeTab !== 'info' && 'hidden')}>
          <SessionInfoPanel session={session} />
        </div>
      </div>
    </div>
  )
}
