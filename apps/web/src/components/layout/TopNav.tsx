import { useSessionStore } from '@/stores/session-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  LayoutGrid,
  Columns3,
  Plus,
  Radio,
  X,
  Circle,
  RefreshCw,
} from 'lucide-react'
import { useWebSocket } from '@/hooks/useWebSocket'

const statusColorMap: Record<string, string> = {
  running: 'text-green-500',
  waiting: 'text-amber-500',
  failed: 'text-red-500',
  completed: 'text-blue-500',
  initializing: 'text-slate-400',
  paused: 'text-orange-500',
  review: 'text-purple-500',
}

const connColors: Record<string, string> = {
  connected: 'fill-green-500 text-green-500',
  connecting: 'fill-amber-400 text-amber-400 animate-pulse',
  disconnected: 'fill-orange-500 text-orange-500',
  failed: 'fill-red-500 text-red-500',
}

const connLabels: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '已断线，重连中',
  failed: '连接失败',
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
    connectionStatus,
    disconnectedAt,
  } = useSessionStore()
  const { reconnect } = useWebSocket()

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
        {/* WebSocket 连接状态 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              onClick={connectionStatus === 'failed' ? reconnect : undefined}
            >
              {connectionStatus === 'failed' ? (
                <RefreshCw className="h-3 w-3 text-red-500" />
              ) : (
                <Circle className={`h-2 w-2 ${connColors[connectionStatus] ?? ''}`} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p>{connLabels[connectionStatus] ?? connectionStatus}</p>
            {disconnectedAt && connectionStatus === 'disconnected' && (
              <p className="text-muted-foreground">
                断线 {Math.round((Date.now() - disconnectedAt) / 1000)}s
              </p>
            )}
            {connectionStatus === 'failed' && (
              <p className="text-muted-foreground">点击手动重连</p>
            )}
          </TooltipContent>
        </Tooltip>
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
