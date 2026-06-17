import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  PanelLeft,
  PanelRight,
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
  return (
    <header className="flex h-12 shrink-0 items-center gap-0 border-b border-transparent bg-panel px-3">

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

      {/* Right: actions */}
      <div className="ml-auto flex items-center gap-1.5">
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
