import { memo, useCallback, useMemo, useState } from 'react'
import { FileText, Plus, X, Terminal, GitCompare } from 'lucide-react'
import { CreateTerminalDialog } from './CreateTerminalDialog'
import { TabContextMenu } from './TabContextMenu'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { cn } from '@/lib/utils'
import type { AgentSession, SessionTab } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { resolveAbsoluteFilePath } from '@/lib/path-utils'
import { destroyTerminalInstance } from './terminal-instances'
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
    t => t.id !== tab.id && t.type === tab.type && t.filePath && t.filePath.split(/[/\\]/).pop() === fileName
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
  displayLabel,
  tooltipContent,
  onContextMenu,
}: {
  sessionId: string
  tab: AgentSession['tabs'][number]
  isActive: boolean
  displayLabel: string
  tooltipContent: string
  onContextMenu?: (e: React.MouseEvent) => void
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
    ? GitCompare
    : tab.type === 'file'
      ? FileText
      : tab.type === 'claude'
        ? ClaudeIcon
        : Terminal

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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    onContextMenu?.(e)
  }, [onContextMenu])

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          onClick={handleActivate}
          onContextMenu={handleContextMenu}
          className={cn(
            'group relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors select-none focus:outline-none',
            isActive
              ? 'bg-zinc-100 text-foreground dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800',
            isDragging && 'opacity-60',
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
      <TooltipContent side="bottom" className="max-w-none break-all">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  )
})

export function MiddleTabBar({ session }: MiddleTabBarProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ tab: SessionTab; x: number; y: number } | null>(null)
  const reorderTabs = useSessionStore(s => s.reorderTabs)
  const tabs = session.tabs
  const activeTabId = session.activeTabId
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === session.workspaceId) ?? null)

  const tabMeta = useMemo(() => {
    return tabs.map(tab => {
      const rawLabel = getTabDisplayLabel(tab, tabs)
      const displayLabel = tab.type === 'diff' ? `(diff) ${rawLabel}` : rawLabel
      const tooltipContent = tab.filePath
        ? tab.type === 'diff'
          ? `Diff: ${resolveAbsoluteFilePath(session.worktreePath, tab.filePath, workspace)}`
          : resolveAbsoluteFilePath(session.worktreePath, tab.filePath, workspace)
        : tab.label
      return { tab, displayLabel, tooltipContent }
    })
  }, [tabs, session.worktreePath, workspace])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const handleContextMenu = useCallback((tab: SessionTab, e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ tab, x: e.clientX, y: e.clientY })
  }, [])

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

  return (
    <div className="flex h-12 shrink-0 items-center bg-[var(--terminal-background)]">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map(t => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex h-full flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden tabs-scrollbar px-2">
            {tabMeta.map(({ tab, displayLabel, tooltipContent }) => (
              <SortableTab
                key={tab.id}
                sessionId={session.id}
                tab={tab}
                isActive={tab.id === activeTabId}
                displayLabel={displayLabel}
                tooltipContent={tooltipContent}
                onContextMenu={e => handleContextMenu(tab, e)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {contextMenu && (
        <TabContextMenu
          sessionId={session.id}
          tab={contextMenu.tab}
          tabs={tabs}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}

      <Button
        variant="ghost"
        size="xs"
        className="mr-1 h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        onClick={() => setCreateDialogOpen(true)}
        title="新建终端"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>

      <CreateTerminalDialog
        sessionId={session.id}
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  )
}
