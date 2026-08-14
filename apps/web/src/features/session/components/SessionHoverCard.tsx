import { memo } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, FolderGit2, GitBranch } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { sessionDiffTotals } from '@/features/session/lib/session-ui'
import { StatusIcon } from '@/features/session/components/SessionStatusIcon'
import { getAgentConfig } from '@/shared/lib/agent-config'
import type { AgentSession } from '@akari/shared-types'

interface SessionHoverCardProps {
  session: AgentSession
}

/** 分支 pill：mono 描边小徽章，对齐 Codex 的分支展示 */
function BranchChip({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-[45%] items-center rounded-md border border-border/60 bg-muted/40 px-1.5 py-px font-mono text-[10px] leading-4',
        muted ? 'text-muted-foreground' : 'text-foreground/80'
      )}
    >
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * 悬停会话时弹出的信息面板（分支 / 标题 / git 信息）。
 * 领先/落后仅对比分支上游 @{upstream}，无上游时不展示该区块。
 */
export const SessionHoverCard = memo(function SessionHoverCard({ session }: SessionHoverCardProps) {
  const ab = session.aheadBehind
  const { icon: AgentIcon, color } = getAgentConfig(session.agentType)
  const { additions, deletions } = sessionDiffTotals(session)
  const hasUpstream = !!ab
  const synced = hasUpstream && ab!.ahead === 0 && ab!.behind === 0
  const hasDiff = additions > 0 || deletions > 0

  return (
    <div className="text-xs">
      {/* 标题行：状态 + 名称 + Agent 图标 */}
      <div className="flex items-center gap-2">
        <StatusIcon status={session.status} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{session.name}</span>
        <AgentIcon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      </div>

      {/* 分支 → 基准 */}
      <div className="mt-2 flex items-center gap-1.5">
        <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
        <BranchChip name={session.branchName || '—'} />
        {!session.isMain && session.baseBranch && (
          <>
            <span className="shrink-0 text-[10px] text-muted-foreground/60">→</span>
            <BranchChip name={session.baseBranch} muted />
          </>
        )}
      </div>

      {/* Git 状态：diff 统计 + 领先/落后，tabular-nums 对齐 */}
      {(hasDiff || hasUpstream) && (
        <div className="mt-2.5 flex items-center gap-3 font-mono text-[11px] tabular-nums">
          {hasDiff && (
            <span className="flex items-center gap-1.5">
              {additions > 0 && <span className="text-green-600 dark:text-green-500">+{additions}</span>}
              {deletions > 0 && <span className="text-red-600 dark:text-red-500">-{deletions}</span>}
            </span>
          )}
          {hasUpstream && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {synced ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span className="font-sans">已同步</span>
                </>
              ) : (
                <>
                  {ab!.behind > 0 && (
                    <span className="flex items-center gap-px">
                      <ArrowDown className="h-3 w-3" strokeWidth={1.5} />
                      {ab!.behind}
                    </span>
                  )}
                  {ab!.ahead > 0 && (
                    <span className="flex items-center gap-px">
                      <ArrowUp className="h-3 w-3" strokeWidth={1.5} />
                      {ab!.ahead}
                    </span>
                  )}
                </>
              )}
            </span>
          )}
          {hasUpstream && (
            <span className="ml-auto truncate text-[10px] text-muted-foreground/70">相对 {ab!.ref}</span>
          )}
        </div>
      )}

      {/* 任务描述预览 */}
      {session.task && (
        <p className="mt-2.5 line-clamp-2 leading-relaxed text-muted-foreground">
          {session.task}
        </p>
      )}

      {/* worktree 路径 */}
      {session.worktreePath && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <FolderGit2 className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate font-mono" title={session.worktreePath}>
            {session.worktreePath}
          </span>
        </div>
      )}
    </div>
  )
})
