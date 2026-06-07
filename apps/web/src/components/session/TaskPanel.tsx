import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  idle: '闲置中',
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
  idle: 'secondary',
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
  const archiveSession = useSessionStore(s => s.archiveSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const pendingOps = useSessionStore(s => s.pendingOps)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isPending = pendingOps.has(session.id)
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

      {session.status === 'running' && (
        <Button size="sm" variant="outline">
          暂停
        </Button>
      )}

      {/* Diff summary */}
      {session.diffFiles && session.diffFiles.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">变更摘要</h3>
          <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1">
            {session.diffFiles.map(f => (
              <div key={f.path} className="flex items-center gap-1.5 text-xs font-mono">
                <span
                  className={
                    f.status === 'A'
                      ? 'w-3 text-green-500'
                      : f.status === 'D'
                        ? 'w-3 text-red-500'
                        : f.status === 'R'
                          ? 'w-3 text-blue-500'
                          : 'w-3 text-amber-500'
                  }
                >
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{f.path}</span>
                <span className="shrink-0 text-green-500">+{f.additions}</span>
                <span className="shrink-0 text-red-400">-{f.deletions}</span>
              </div>
            ))}
          </div>
          {(session.diffSummary.additions > 0 || session.diffSummary.deletions > 0) && (
            <p className="text-xs text-muted-foreground">
              {session.diffSummary.additions > 0 && `${session.diffSummary.additions} 处新增`}
              {session.diffSummary.additions > 0 && session.diffSummary.deletions > 0 && '，'}
              {session.diffSummary.deletions > 0 && `${session.diffSummary.deletions} 处删除`}
            </p>
          )}
        </div>
      )}

      {session.status === 'failed' && (
        <Button size="sm">重试</Button>
      )}

      {/* 归档 / 恢复 / 删除 */}
      <div className="border-t border-border pt-3 space-y-2">
        {!isTerminal && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={isPending}
            onClick={() => archiveSession(session.id)}
          >
            {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
            归档（终止进程，保留 Worktree）
          </Button>
        )}
        {session.status === 'archived' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={() => restoreSession(session.id)}
            >
              {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              恢复正常
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              disabled={isPending}
              onClick={() => setConfirmDelete(true)}
            >
              彻底删除（清理 Worktree + 分支）
            </Button>
          </>
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
