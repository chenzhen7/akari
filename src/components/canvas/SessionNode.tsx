import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Circle } from 'lucide-react'
import type { AgentSession } from '@/types'

type SessionNodeData = {
  session: AgentSession
}

type SessionNodeType = Node<SessionNodeData>

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

function SessionNodeInner({ data }: NodeProps<SessionNodeType>) {
  const session = data.session

  const colorClass = statusColorMap[session.status] || 'text-slate-400'
  const borderColorClass = colorClass.replace('text-', 'border-')

  const miniTerminal = session.terminalOutput.slice(-2)

  return (
    <Card
      className={`w-[280px] cursor-pointer border-2 ${borderColorClass} bg-card shadow-md`}
    >
      <CardHeader className="flex flex-row items-center gap-2 p-3 pb-2">
        <Circle className={`h-3 w-3 fill-current ${colorClass}`} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{session.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {session.branchName}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        <div className="flex items-center justify-between text-xs">
          <span className={`font-medium ${colorClass}`}>
            {statusLabelMap[session.status] || session.status}
          </span>
          <span className="text-muted-foreground">{session.progress}%</span>
        </div>
        <Progress value={session.progress} className="h-1.5" />

        {/* Mini terminal preview */}
        <div className="space-y-0.5 rounded bg-muted/50 p-1.5 font-mono text-[10px] text-muted-foreground">
          {miniTerminal.map((line: string, i: number) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function areEqual(
  prev: NodeProps<SessionNodeType>,
  next: NodeProps<SessionNodeType>
): boolean {
  const p = prev.data.session
  const n = next.data.session
  return (
    p.id === n.id &&
    p.name === n.name &&
    p.status === n.status &&
    p.progress === n.progress &&
    p.branchName === n.branchName &&
    p.canvasPosition.x === n.canvasPosition.x &&
    p.canvasPosition.y === n.canvasPosition.y
  )
}

export const SessionNode = memo(SessionNodeInner, areEqual)
