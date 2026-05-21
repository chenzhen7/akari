import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'

const statusLabelMap: Record<string, string> = {
  running: '运行中',
  waiting: '待审批',
  failed: '失败',
  completed: '已完成',
  initializing: '初始化中',
  paused: '已暂停',
  review: '审查中',
}

const statusVariantMap: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  running: 'default',
  waiting: 'secondary',
  failed: 'destructive',
  completed: 'outline',
  initializing: 'secondary',
  paused: 'secondary',
  review: 'secondary',
}

interface TaskPanelProps {
  session: AgentSession
}

export function TaskPanel({ session }: TaskPanelProps) {
  const approveSession = useSessionStore(s => s.approveSession)
  const rejectSession = useSessionStore(s => s.rejectSession)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">任务描述</h3>
        <Textarea
          readOnly
          value={session.task}
          className="min-h-[100px] resize-none text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">状态：</span>
        <Badge variant={statusVariantMap[session.status] || 'secondary'}>
          {statusLabelMap[session.status] || session.status}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">进度</span>
          <span>{session.progress}%</span>
        </div>
        <Progress value={session.progress} />
      </div>

      <div className="space-y-1 text-sm">
        <div className="flex gap-2">
          <span className="text-muted-foreground">分支：</span>
          <span className="font-mono">{session.branchName}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">基础分支：</span>
          <span>{session.baseBranch}</span>
        </div>
      </div>

      {session.status === 'waiting' && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => approveSession(session.id)}>
            批准
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rejectSession(session.id)}
          >
            拒绝
          </Button>
        </div>
      )}

      {session.status === 'running' && (
        <Button size="sm" variant="outline">
          暂停
        </Button>
      )}

      {session.status === 'failed' && (
        <Button size="sm">重试</Button>
      )}
    </div>
  )
}
