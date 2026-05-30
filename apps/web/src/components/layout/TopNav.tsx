import { useSessionStore } from '@/stores/session-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  running:      'fill-green-500  text-green-500',
  waiting:      'fill-amber-500  text-amber-500',
  failed:       'fill-red-500    text-red-500',
  completed:    'fill-blue-500   text-blue-500',
  initializing: 'fill-slate-400  text-slate-400',
  paused:       'fill-orange-500 text-orange-500',
  review:       'fill-purple-500 text-purple-500',
}

const connColors: Record<string, string> = {
  connected:    'fill-green-500 text-green-500',
  connecting:   'fill-amber-400 text-amber-400 animate-pulse',
  disconnected: 'fill-orange-500 text-orange-500',
  failed:       'fill-red-500 text-red-500',
}

const connLabels: Record<string, string> = {
  connected:    '已连接',
  connecting:   '连接中…',
  disconnected: '已断线，重连中',
  failed:       '连接失败',
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
    <header className="flex h-12 shrink-0 items-center gap-0 border-b border-border bg-card px-3">

      {/* Brand */}
      <div className="flex items-center gap-2 px-1 pr-3">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground font-bold text-xs">
          A
        </div>
        <span className="text-sm font-medium">Akari</span>
      </div>


      {/* View mode switcher */}
      <div className="px-2">
        <Tabs
          value={viewMode}
          onValueChange={v => {
            setViewMode(v as 'canvas' | 'kanban')
            setActiveTab(null)
          }}
        >
          <TabsList className="h-7">
            <TabsTrigger value="canvas" className="gap-1.5 px-2.5 text-xs">
              <LayoutGrid className="h-3.5 w-3.5" />
              画布
            </TabsTrigger>
            <TabsTrigger value="kanban" className="gap-1.5 px-2.5 text-xs">
              <Columns3 className="h-3.5 w-3.5" />
              看板
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>


      {/* Session tabs */}
      <div className="flex flex-1 items-center gap-0.5 overflow-x-auto px-1">
        {openTabs.map(tabId => {
          const session = sessions.find(s => s.id === tabId)
          if (!session) return null
          const isActive = activeTabId === tabId
          const dotCls = statusColorMap[session.status] ?? 'fill-slate-400 text-slate-400'
          return (
            <Button
              key={tabId}
              variant={isActive ? 'secondary' : 'ghost'}
         
              className="h-7 max-w-[160px] gap-1.5 px-2.5 text-xs"
              onClick={() => setActiveTab(tabId)}
            >
              <Circle className={`h-2 w-2 shrink-0 ${dotCls}`} />
              <span className="truncate">{session.name}</span>
              <X
                className="h-3 w-3 shrink-0 opacity-50 hover:opacity-100"
                onClick={e => {
                  e.stopPropagation()
                  closeTab(tabId)
                }}
              />
            </Button>
          )
        })}
      </div>

      {/* Right: stats + connection + actions */}
      <div className="flex items-center gap-1.5 pl-1">
        {/* Session status counters */}
        <Badge variant="outline" className="h-6 gap-1 px-2 text-xs font-normal">
          <Circle className="h-2 w-2 fill-green-500 text-green-500" />
          {runningCount}
        </Badge>
        <Badge variant="outline" className="h-6 gap-1 px-2 text-xs font-normal">
          <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
          {waitingCount}
        </Badge>


        {/* WebSocket 连接状态 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size='xs'
              className="h-7 w-7 p-0"
              onClick={connectionStatus === 'failed' ? reconnect : undefined}
            >
              {connectionStatus === 'failed' ? (
                <RefreshCw className="h-3.5 w-3.5 text-red-500" />
              ) : (
                <Circle className={`h-2.5 w-2.5 ${connColors[connectionStatus] ?? ''}`} />
              )}
            </Button>
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
          variant="ghost"
          className="h-7 gap-1.5 text-xs relative"
          onClick={toggleCommandCenter}
        >
          <Radio className="h-3.5 w-3.5" />
          指挥中心
          {waitingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
              {waitingCount}
            </span>
          )}
        </Button>
        <Button
     
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
