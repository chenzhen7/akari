import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2, PanelLeftClose, PanelLeftOpen, Terminal, GitBranch, FileCode } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'
import { useWebSocket } from '@/hooks/useWebSocket'
import { TerminalPanel } from './TerminalPanel'
import { SessionSidebar } from './SessionSidebar'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { GitGraphPanel } from '@/components/git/GitGraphPanel'
import { cn } from '@/lib/utils'

type MainTab = 'terminal' | 'git-graph' | 'diff'

const TABS: { id: MainTab; label: string; icon: React.ElementType }[] = [
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'git-graph', label: 'Git Graph', icon: GitBranch },
  { id: 'diff', label: 'Diff', icon: FileCode },
]

export function SessionDetail() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const setActiveTab = useSessionStore(s => s.setActiveTab)
  const { send } = useWebSocket()
  const [mainTab, setMainTab] = useState<MainTab>('terminal')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const session = sessions.find(s => s.id === activeTabId)
  if (!session) return null

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setActiveTab(null)}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
        >
          {sidebarOpen
            ? <PanelLeftClose className="h-3.5 w-3.5" />
            : <PanelLeftOpen className="h-3.5 w-3.5" />}
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-medium">{session.name}</span>
        {session.status === 'initializing' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div
          className={cn(
            'shrink-0 overflow-hidden border-r border-border transition-all duration-200',
            sidebarOpen ? 'w-72' : 'w-0',
          )}
        >
          <SessionSidebar session={session} />
        </div>

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1">
            {TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setMainTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                    mainTab === tab.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {tab.label}
                  {tab.id === 'diff' && (session.diffFiles?.length ?? 0) > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/20 px-1 text-[10px] text-primary">
                      {session.diffFiles!.length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab panels — Terminal always mounted to preserve xterm instance */}
          <div className="relative flex-1 overflow-hidden">
            <div className={cn('absolute inset-0', mainTab === 'terminal' ? 'flex' : 'hidden')}>
              <TerminalPanel session={session} send={send} />
            </div>
            <div className={cn('absolute inset-0', mainTab === 'git-graph' ? 'flex' : 'hidden')}>
              <GitGraphPanel sessionId={session.id} />
            </div>
            <div className={cn('absolute inset-0 overflow-hidden', mainTab === 'diff' ? 'flex flex-col' : 'hidden')}>
              <DiffViewer sessionId={session.id} diffFiles={session.diffFiles} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
