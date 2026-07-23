import { DndContext, type DragEndEvent, rectIntersection } from '@dnd-kit/core'
import { useSessionStore } from '@/features/session/stores/session-store'
import { KanbanColumn } from './KanbanColumn'
import type { KanbanColumn as KanbanColumnType } from '@/types'

const COLUMNS: { id: KanbanColumnType; label: string }[] = [
  { id: 'backlog', label: '待办' },
  { id: 'in-progress', label: '进行中' },
  { id: 'approved', label: '已批准' },
  { id: 'done', label: '已完成' },
]

export function KanbanView() {
  const sessions = useSessionStore(s => s.sessions)
  const moveToColumn = useSessionStore(s => s.moveToColumn)

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const targetId = over.id as string
    const isColumn = COLUMNS.some(c => c.id === targetId)
    if (isColumn) {
      moveToColumn(active.id as string, targetId as KanbanColumnType)
    }
  }

  return (
    <div className="h-full overflow-x-auto p-4">
      <DndContext collisionDetection={rectIntersection} onDragEnd={onDragEnd}>
        <div className="flex h-full min-w-max gap-4">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              column={col.id}
              label={col.label}
              sessions={sessions.filter(s => s.kanbanColumn === col.id)}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
