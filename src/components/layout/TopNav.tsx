import { useSessionStore } from '@/stores/session-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  LayoutGrid,
  Columns3,
  Plus,
  Radio,
  X,
  Circle,
} from 'lucide-react'

const statusColorMap: Record<string, string> = {
  running: 'text-green-500',
  waiting: 'text-amber-500',
  failed: 'text-red-500',
  completed: 'text-blue-500',
  initializing: 'text-slate-400',
  paused: 'text-orange-500',
  review: 'text-purple-500',
}

export function TopNav() {
  const {
    viewMode,
    setViewMode,
    openTabs,
    activeTabId,
    setActiveTab,
    closeTab,
    toggleCreateDialog,
    toggleCommandCenter,
    sessions,
  } = useSessionStore()

  const runningCount = sessions.filter(s => s.status === 'running').length
  const waitingCount = sessions.filter(s => s.status === 'waiting').length

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      {/* Left: Brand + View Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            A
          </div>
          <span className="font-semibold text-sm">Akari</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          <Button
            variant={viewMode === 'canvas' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setViewMode('canvas')}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            画布
          </Button>
          <Button
            variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setViewMode('kanban')}
          >
            <Columns3 className="h-3.5 w-3.5" />
            看板
          </Button>
        </div>
      </div>

      {/* Center: Tabs */}
      <div className="flex flex-1 items-center gap-1 overflow-x-auto px-2">
        {openTabs.map(tabId => {
          const session = sessions.find(s => s.id === tabId)
          if (!session) return null
          const isActive = activeTabId === tabId
          return (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Circle
                className={`h-2 w-2 fill-current ${statusColorMap[session.status] || 'text-slate-400'}`}
              />
              <span className="max-w-[120px] truncate">{session.name}</span>
              <X
                className="h-3 w-3 opacity-60 hover:opacity-100"
                onClick={e => {
                  e.stopPropagation()
                  closeTab(tabId)
                }}
              />
            </button>
          )
        })}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-6 gap-1 text-xs font-normal">
            <Circle className="h-2 w-2 fill-green-500 text-green-500" />
            {runningCount}
          </Badge>
          <Badge variant="outline" className="h-6 gap-1 text-xs font-normal">
            <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
            {waitingCount}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={toggleCommandCenter}
        >
          <Radio className="h-3.5 w-3.5" />
          指挥中心
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={toggleCreateDialog}
        >
          <Plus className="h-3.5 w-3.5" />
          新建会话
        </Button>
      </div>
    </header>
  )
}
