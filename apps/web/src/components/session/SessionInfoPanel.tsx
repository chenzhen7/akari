import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
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
  waiting: '待审批',
  failed: '失败',
  completed: '已完成',
  initializing: '初始化中',
  paused: '已暂停',
  review: '审查中',
}

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  waiting: 'secondary',
  failed: 'destructive',
  completed: 'outline',
  initializing: 'secondary',
  paused: 'secondary',
  review: 'secondary',
}

interface SessionInfoPanelProps {
  session: AgentSession
}

export function SessionInfoPanel({ session }: SessionInfoPanelProps) {
  const approveSession = useSessionStore(s => s.approveSession)
  const rejectSession = useSessionStore(s => s.rejectSession)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isTerminal = ['archived', 'merged'].includes(session.status)

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3 space-y-4">
      {/* Task description */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">任务描述</p>
        <Textarea
          readOnly
          value={session.task}
          className="min-h-[80px] resize-none text-sm"
        />
      </div>

      {/* Status + branches */}
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">状态</span>
          <Badge variant={statusVariantMap[session.status] ?? 'secondary'}>
            {statusLabelMap[session.status] ?? session.status}
          </Badge>
        </div>
        <div className="flex gap-1.5 text-xs">
          <span className="text-muted-foreground">分支</span>
          <span className="font-mono text-foreground">{session.branchName}</span>
        </div>
        <div className="flex gap-1.5 text-xs">
          <span className="text-muted-foreground">基准</span>
          <span className="text-foreground">{session.baseBranch}</span>
        </div>
      </div>

      {/* Approval request detail */}
      {session.status === 'waiting' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <span className="text-xs font-semibold text-amber-400">等待审批</span>
            {session.pendingApproval?.type && (
              <Badge
                variant="outline"
                className="ml-auto text-[10px] border-amber-500/40 text-amber-400"
              >
                {session.pendingApproval.type === 'destructive-op' ? '高危操作'
                  : session.pendingApproval.type === 'merge-ready' ? '合并就绪'
                  : '检查点'}
              </Badge>
            )}
          </div>
          {session.pendingApproval?.message && (
            <p className="text-xs text-foreground/80 break-all leading-relaxed">
              {session.pendingApproval.message}
            </p>
          )}
          {session.pendingApproval?.command && (
            <code className="block rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] text-amber-300/90 break-all">
              {session.pendingApproval.command}
            </code>
          )}
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold" onClick={() => approveSession(session.id)}>批准</Button>
            <Button size="sm" variant="outline" className="flex-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={() => rejectSession(session.id)}>拒绝</Button>
          </div>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Danger zone */}
      <div className="border-t border-border pt-3 space-y-1.5">
        {!isTerminal && (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs"
            onClick={() => archiveSession(session.id)}
          >
            归档（终止进程，保留 Worktree）
          </Button>
        )}
        {session.status === 'archived' && (
          <Button
            size="sm"
            variant="destructive"
            className="w-full text-xs"
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
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>取消</Button>
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
