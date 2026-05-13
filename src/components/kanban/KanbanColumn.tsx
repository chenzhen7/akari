import { useDroppable } from '@dnd-kit/core'
import { KanbanCard } from './KanbanCard'
import type { AgentSession, KanbanColumn as KanbanColumnType } from '@/types'

interface KanbanColumnProps {
  column: KanbanColumnType
  label: string
  sessions: AgentSession[]
}

export function KanbanColumn({ column, label, sessions }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column })

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 flex-col rounded-lg border p-3 transition-colors ${
        isOver
          ? 'border-primary bg-primary/5'
          : 'border-border bg-muted/30'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {sessions.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {sessions.map(session => (
          <KanbanCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  )
}
