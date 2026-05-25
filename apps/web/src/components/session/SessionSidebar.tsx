import { useState } from 'react'
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
import { GitCommit, GitMerge } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { GitCommitDialog } from '@/components/git/GitCommitDialog'
import { GitMergeDialog } from '@/components/git/GitMergeDialog'

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

interface SessionSidebarProps {
  session: AgentSession
}

export function SessionSidebar({ session }: SessionSidebarProps) {
  const approveSession = useSessionStore(s => s.approveSession)
  const rejectSession = useSessionStore(s => s.rejectSession)
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [commitDialogOpen, setCommitDialogOpen] = useState(false)
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)

  const isTerminal = ['archived', 'merged'].includes(session.status)
  const canGitOp = !['archived', 'initializing', 'failed'].includes(session.status)

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

      {/* Approval actions */}
      {session.status === 'waiting' && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => approveSession(session.id)}>批准</Button>
          <Button size="sm" variant="outline" onClick={() => rejectSession(session.id)}>拒绝</Button>
        </div>
      )}

      {/* Changed files */}
      {session.diffFiles && session.diffFiles.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">变更文件</p>
          <div className="rounded-md border border-border bg-muted/30 p-2 space-y-0.5">
            {session.diffFiles.map(f => (
              <div key={f.path} className="flex items-center gap-1.5 text-xs font-mono">
                <span className={
                  f.status === 'A' ? 'w-3 text-green-500' :
                  f.status === 'D' ? 'w-3 text-red-500' :
                  f.status === 'R' ? 'w-3 text-blue-500' :
                  'w-3 text-amber-500'
                }>
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{f.path}</span>
                <span className="shrink-0 text-green-500">+{f.additions}</span>
                <span className="shrink-0 text-red-400">-{f.deletions}</span>
              </div>
            ))}
          </div>
          {session.diffSummary && (
            <p className="mt-1 text-xs text-muted-foreground">{session.diffSummary}</p>
          )}
        </div>
      )}

      {/* Git operations */}
      {canGitOp && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Git 操作</p>
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => setCommitDialogOpen(true)}
            >
              <GitCommit className="h-3.5 w-3.5" />
              提交变更
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => setMergeDialogOpen(true)}
            >
              <GitMerge className="h-3.5 w-3.5" />
              合并分支
            </Button>
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

      {/* Dialogs */}
      <GitCommitDialog
        open={commitDialogOpen}
        onOpenChange={setCommitDialogOpen}
        sessionId={session.id}
        diffFiles={session.diffFiles ?? []}
      />

      <GitMergeDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        sessionId={session.id}
        currentBranch={session.branchName}
      />

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
