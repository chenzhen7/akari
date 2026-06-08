import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { DeleteSessionDialog } from './DeleteSessionDialog'
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

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'default',
  idle: 'secondary',
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
  const archiveSession = useSessionStore(s => s.archiveSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const pendingOps = useSessionStore(s => s.pendingOps)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isPending = pendingOps.has(session.id)
  const isTerminal = ['archived', 'merged'].includes(session.status)
  const isMain = session.isMain ?? false

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
            {isMain ? '主会话' : (statusLabelMap[session.status] ?? session.status)}
          </Badge>
        </div>
        <div className="flex gap-1.5 text-xs">
          <span className="text-muted-foreground">分支</span>
          <span className="font-mono text-foreground">{session.branchName}</span>
        </div>
        {!isMain && (
          <div className="flex gap-1.5 text-xs">
            <span className="text-muted-foreground">基准</span>
            <span className="text-foreground">{session.baseBranch}</span>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Danger zone */}
      {!isMain && (
        <div className="border-t border-border pt-3 space-y-1.5">
          {!isTerminal && (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
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
                className="w-full text-xs"
                disabled={isPending}
                onClick={() => restoreSession(session.id)}
              >
                {isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                恢复正常
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="w-full text-xs"
                disabled={isPending}
                onClick={() => setConfirmDelete(true)}
              >
                彻底删除（清理 Worktree + 分支）
              </Button>
            </>
          )}
        </div>
      )}

      {!isMain && (
        <DeleteSessionDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          sessionId={session.id}
          branchName={session.branchName}
          onConfirm={() => deleteSession(session.id)}
        />
      )}
    </div>
  )
}
