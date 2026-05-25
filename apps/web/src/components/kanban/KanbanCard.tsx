import { useDraggable } from '@dnd-kit/core'
import { Card, CardContent } from '@/components/ui/card'
import { Circle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'

interface KanbanCardProps {
  session: AgentSession
}

const statusColorMap: Record<string, string> = {
  running: 'text-green-500',
  waiting: 'text-amber-500',
  failed: 'text-red-500',
  completed: 'text-blue-500',
  initializing: 'text-slate-400',
  paused: 'text-orange-500',
  review: 'text-purple-500',
}

const statusLabelMap: Record<string, string> = {
  running: '运行中',
  waiting: '待审批',
  failed: '失败',
  completed: '已完成',
  initializing: '初始化中',
  paused: '已暂停',
  review: '审查中',
}

export function KanbanCard({ session }: KanbanCardProps) {
  const openTab = useSessionStore(s => s.openTab)
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: session.id,
    })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined

  const colorClass = statusColorMap[session.status] || 'text-slate-400'

  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className="cursor-grab active:cursor-grabbing"
      onClick={() => openTab(session.id)}
    >
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Circle
            className={`h-2.5 w-2.5 fill-current ${colorClass}`}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {session.name}
          </span>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          {statusLabelMap[session.status] || session.status}
        </Badge>
      </CardContent>
    </Card>
  )
}
