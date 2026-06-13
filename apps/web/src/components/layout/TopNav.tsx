import { useSessionStore, CANVAS_ENABLED } from '@/stores/session-store'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector'
import { useTheme } from '@/components/theme-provider'
import {
  LayoutGrid,
  Columns3,
  Radio,
  PanelLeft,
  PanelRight,
  Sun,
  Moon,
} from 'lucide-react'

interface TopNavProps {
  leftCollapsed: boolean
  onToggleLeft: () => void
  rightCollapsed: boolean
  onToggleRight: () => void
}

export function TopNav({
  leftCollapsed,
  onToggleLeft,
  rightCollapsed,
  onToggleRight: toggleRight,
}: TopNavProps) {
  const {
    globalViewMode,
    setGlobalViewMode,
    toggleCommandCenter,
    sessions,
  } = useSessionStore()
  const { theme, setTheme } = useTheme()

  return (
    <header className="flex h-12 shrink-0 items-center gap-0 border-b border-transparent bg-panel px-3">

      {/* Brand + Workspace */}
      <div className="flex items-center gap-2 px-1 pr-3">
        <svg viewBox="0 0 512 512" className="h-6 w-6">
          <rect x="117" y="106" width="62" height="300" rx="8" className="fill-foreground" />
          <rect x="225" y="106" width="62" height="300" rx="8" className="fill-foreground" />
          <rect x="333" y="106" width="62" height="300" rx="8" className="fill-foreground" />
        </svg>
        <div className="h-4 w-px bg-border mx-1" />
        <WorkspaceSelector />
      </div>

      {/* Session sidebar toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={leftCollapsed ? 'ghost' : 'secondary'}
            size="xs"
            className="h-7 w-7 p-0"
            onClick={onToggleLeft}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {leftCollapsed ? '展开会话列表' : '收起会话列表'}
        </TooltipContent>
      </Tooltip>


      {/* View mode switcher */}
      <div className="px-2">
        <Tabs
          value={globalViewMode ?? ''}
          onValueChange={v => {
            if (!v) return
            setGlobalViewMode(v as 'canvas' | 'kanban')
          }}
        >
          <TabsList className="h-7">
            {CANVAS_ENABLED && (
              <TabsTrigger value="canvas" className="gap-1.5 px-2.5 text-xs">
                <LayoutGrid className="h-3.5 w-3.5" />
                画布
              </TabsTrigger>
            )}
            <TabsTrigger value="kanban" className="gap-1.5 px-2.5 text-xs">
              <Columns3 className="h-3.5 w-3.5" />
              看板
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>


      {/* Right: actions */}
      <div className="ml-auto flex items-center gap-1.5">
        {/* Theme toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="h-7 w-7 p-0"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {theme === 'dark' ? '切换浅色模式' : '切换深色模式'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className="h-7 gap-1.5 text-xs relative"
              onClick={toggleCommandCenter}
            >
              <Radio className="h-3.5 w-3.5" />
              指挥中心
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">指挥中心</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={rightCollapsed ? 'ghost' : 'secondary'}
              size="xs"
              className="h-7 w-7 p-0"
              onClick={toggleRight}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {rightCollapsed ? '展开详情' : '收起详情'}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
