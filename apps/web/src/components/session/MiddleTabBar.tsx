import { memo, useCallback } from 'react'
import { FileCode, FileText, Plus, X, Terminal } from 'lucide-react'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { cn } from '@/lib/utils'
import type { AgentSession, SessionTab } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { destroyTerminalInstance } from './TerminalPanel'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function getTabDisplayLabel(tab: SessionTab, allTabs: SessionTab[]): string {
  if (!tab.filePath || (tab.type !== 'file' && tab.type !== 'diff')) {
    return tab.label
  }
  const parts = tab.filePath.split(/[/\\]/)
  const fileName = parts[parts.length - 1] ?? tab.label
  const sameNameTabs = allTabs.filter(
    t => t.id !== tab.id && t.filePath && t.filePath.split(/[/\\]/).pop() === fileName
  )
  if (sameNameTabs.length === 0) {
    return fileName
  }
  for (let depth = 2; depth <= parts.length; depth++) {
    const candidate = parts.slice(-depth).join('/')
    const isDuplicate = sameNameTabs.some(
      t => t.filePath!.split(/[/\\]/).slice(-depth).join('/') === candidate
    )
    if (!isDuplicate) {
      return candidate
    }
  }
  return tab.filePath
}

interface MiddleTabBarProps {
  session: AgentSession
}

const SortableTab = memo(function SortableTab({
  sessionId,
  tab,
  isActive,
  allTabs,
}: {
  sessionId: string
  tab: AgentSession['tabs'][number]
  isActive: boolean
  allTabs: SessionTab[]
}) {
  const activateTab = useSessionStore(s => s.activateTab)
  const closeTab = useSessionStore(s => s.closeTab)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  }

  const Icon = tab.type === 'diff'
    ? FileCode
    : tab.type === 'file'
      ? FileText
      : tab.type === 'claude'
        ? ClaudeIcon
        : Terminal

  const displayLabel = getTabDisplayLabel(tab, allTabs)
  const tooltipContent = tab.filePath ?? tab.label

  const handleActivate = useCallback(() => {
    activateTab(sessionId, tab.id)
  }, [activateTab, sessionId, tab.id])

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if ((tab.type === 'terminal' || tab.type === 'claude') && tab.terminalId) {
      destroyTerminalInstance(tab.terminalId)
    }
    closeTab(sessionId, tab.id)
  }, [tab.type, tab.terminalId, tab.id, sessionId, closeTab])

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          onClick={handleActivate}
          className={cn(
            'group relative flex h-full shrink-0 items-center gap-1.5 px-2.5 text-xs transition-colors select-none focus:outline-none',
            isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            isDragging && 'opacity-60',
            isActive && 'after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:rounded-full after:bg-primary',
          )}
        >
          {tab.type === 'claude' ? (
            <ClaudeIcon className="h-3 w-3 shrink-0 text-[#D97757]" />
          ) : (
            <Icon className="h-3 w-3 shrink-0" />
          )}
          <span className="max-w-[120px] truncate">{displayLabel}</span>
          <span
            onClick={handleClose}
            onPointerDown={e => e.stopPropagation()}
            className={cn(
              'ml-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity',
              isActive ? 'opacity-100' : 'group-hover:opacity-100',
              'hover:bg-destructive/10 hover:text-destructive',
            )}
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  )
})

export function MiddleTabBar({ session }: MiddleTabBarProps) {
  const createTerminal = useSessionStore(s => s.createTerminal)
  const reorderTabs = useSessionStore(s => s.reorderTabs)
  const tabs = session.tabs
  const activeTabId = session.activeTabId

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex(t => t.id === active.id)
      const newIndex = tabs.findIndex(t => t.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = [...tabs]
        const [moved] = reordered.splice(oldIndex, 1)
        reordered.splice(newIndex, 0, moved)
        reorderTabs(session.id, reordered.map(t => t.id))
      }
    }
  }, [tabs, session.id, reorderTabs])

  const handleCreateTerminal = useCallback(() => {
    createTerminal(session.id)
  }, [createTerminal, session.id])

  return (
    <div className="flex h-10 shrink-0 items-center bg-background dark:bg-[#1e1e1e]">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map(t => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex h-full flex-1 items-center overflow-x-auto no-scrollbar">
            {tabs.map(tab => (
              <SortableTab
                key={tab.id}
                sessionId={session.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                allTabs={tabs}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        variant="ghost"
        size="xs"
        className="mr-1 h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={handleCreateTerminal}
        title="新建终端"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
