import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isTerminal = ['archived', 'merged'].includes(session.status)

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
          <span className="font-mono text-xs">{session.branchName}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">基础分支：</span>
          <span>{session.baseBranch}</span>
        </div>
      </div>

      {/* 审批操作 */}
      {session.status === 'waiting' && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => approveSession(session.id)}>
            批准
          </Button>
          <Button size="sm" variant="outline" onClick={() => rejectSession(session.id)}>
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

      {/* 归档 / 删除 */}
      <div className="border-t border-border pt-3 space-y-2">
        {!isTerminal && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => archiveSession(session.id)}
          >
            归档（终止进程，保留 Worktree）
          </Button>
        )}
        {session.status === 'archived' && (
          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            onClick={() => setConfirmDelete(true)}
          >
            彻底删除（清理 Worktree + 分支）
          </Button>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>彻底删除会话</DialogTitle>
            <DialogDescription>
              将删除 Worktree 目录（
              <span className="font-mono text-foreground">.agent-worktrees/{session.id}</span>
              ）和分支（
              <span className="font-mono text-foreground">{session.branchName}</span>
              ），此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteSession(session.id)
                setConfirmDelete(false)
              }}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
