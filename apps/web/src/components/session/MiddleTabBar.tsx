import { Terminal, FileCode, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { destroyTerminalInstance } from './TerminalPanel'
import { Button } from '@/components/ui/button'

interface MiddleTabBarProps {
  session: AgentSession
}

export function MiddleTabBar({ session }: MiddleTabBarProps) {
  const closeTab = useSessionStore(s => s.closeTab)
  const activateTab = useSessionStore(s => s.activateTab)
  const createTerminal = useSessionStore(s => s.createTerminal)
  const tabs = session.tabs
  const activeTabId = session.activeTabId

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.type === 'terminal' && tab.terminalId) {
      destroyTerminalInstance(tab.terminalId)
    }
    closeTab(session.id, tabId)
  }

  const handleCreateTerminal = () => {
    createTerminal(session.id)
  }

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border bg-muted/30">
      {/* Tabs */}
      <div className="flex h-full flex-1 items-center overflow-x-auto scrollbar-hide">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId
          const Icon = tab.type === 'terminal' ? Terminal : FileCode
          return (
            <button
              key={tab.id}
              onClick={() => activateTab(session.id, tab.id)}
              className={cn(
                'group relative flex h-full shrink-0 items-center gap-1.5 border-r border-border/50 px-2.5 text-xs transition-colors',
                isActive
                  ? 'bg-[#1e1e1e] text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50',
                isActive && 'after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:rounded-full after:bg-primary',
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="max-w-[120px] truncate">{tab.label}</span>
              <span
                onClick={e => handleClose(e, tab.id)}
                className={cn(
                  'ml-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity',
                  isActive ? 'opacity-100' : 'group-hover:opacity-100',
                  'hover:bg-destructive/10 hover:text-destructive',
                )}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          )
        })}
      </div>

      {/* New terminal button */}
      <Button
        variant="ghost"
        size="xs"
        className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={handleCreateTerminal}
        title="新建终端"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
