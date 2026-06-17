import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  PanelLeft,
  PanelRight,
  Minus,
  Square,
  Copy,
  X,
} from 'lucide-react'

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)
  const electron = window.electron

  useEffect(() => {
    if (!electron?.windowControls) return
    void electron.windowControls.isMaximized().then(setIsMaximized)
    return electron.windowControls.onMaximizedChange(setIsMaximized)
  }, [])

  if (!electron?.windowControls) return null

  return (
    <div className="flex h-full items-center app-region-no-drag">
      <button
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700 app-region-no-drag"
        onClick={() => electron.windowControls?.minimize()}
        title="最小化"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700 app-region-no-drag"
        onClick={() => electron.windowControls?.maximize()}
        title={isMaximized ? '还原' : '最大化'}
      >
        {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        className="flex h-full w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-red-600 hover:text-white app-region-no-drag"
        onClick={() => electron.windowControls?.close()}
        title="关闭"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

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
  return (
    <header
      className="flex h-10 shrink-0 items-center gap-0 border-b border-transparent bg-panel pl-3 pr-0 app-region-drag"
    >

      {/* Brand */}
      <div className="flex items-center gap-2 px-1 pr-3">
        <svg viewBox="0 0 512 512" className="h-6 w-6">
          <rect x="117" y="106" width="62" height="300" rx="8" className="fill-foreground" />
          <rect x="225" y="106" width="62" height="300" rx="8" className="fill-foreground" />
          <rect x="333" y="106" width="62" height="300" rx="8" className="fill-foreground" />
        </svg>
      </div>

      {/* Session sidebar toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={leftCollapsed ? 'ghost' : 'secondary'}
            size="xs"
            className="h-7 w-7 p-0 app-region-no-drag"
            onClick={onToggleLeft}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {leftCollapsed ? '展开会话列表' : '收起会话列表'}
        </TooltipContent>
      </Tooltip>

      {/* Right: actions */}
      <div className="ml-auto flex h-full items-center gap-1.5 app-region-no-drag">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={rightCollapsed ? 'ghost' : 'secondary'}
              size="xs"
              className="h-7 w-7 p-0 app-region-no-drag"
              onClick={toggleRight}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {rightCollapsed ? '展开详情' : '收起详情'}
          </TooltipContent>
        </Tooltip>

        <WindowControls />
      </div>
    </header>
  )
}
