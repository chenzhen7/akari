import type React from 'react'
import { cn } from '@/lib/utils'
import { Terminal, GitBranch, FileCode, Info, Archive } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type ActivePanel = 'terminal' | 'git-graph' | 'diff' | 'info'

interface ActivityBarProps {
  activePanel: ActivePanel
  onPanelChange: (panel: ActivePanel) => void
  diffCount: number
  onArchive: () => void
  showArchive: boolean
}

const NAV_ITEMS: { id: ActivePanel; icon: React.ElementType; label: string }[] = [
  { id: 'terminal',   icon: Terminal,   label: '终端' },
  { id: 'git-graph',  icon: GitBranch,  label: 'Git Graph' },
  { id: 'diff',       icon: FileCode,   label: '变更 Diff' },
  { id: 'info',       icon: Info,       label: '任务信息' },
]

export function ActivityBar({ activePanel, onPanelChange, diffCount, onArchive, showArchive }: ActivityBarProps) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center border-r border-border bg-muted/20 py-1">
      <div className="flex flex-1 flex-col">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onPanelChange(id)}
                className={cn(
                  'group relative flex h-11 w-12 items-center justify-center transition-colors',
                  activePanel === id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {activePanel === id && (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
                )}
                <Icon className="h-[18px] w-[18px]" />
                {id === 'diff' && diffCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold leading-none text-primary-foreground">
                    {diffCount > 9 ? '9+' : diffCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {showArchive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onArchive}
              className="mb-1 flex h-11 w-12 items-center justify-center text-muted-foreground transition-colors hover:text-amber-500"
            >
              <Archive className="h-[18px] w-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">归档（终止进程，保留 Worktree）</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
