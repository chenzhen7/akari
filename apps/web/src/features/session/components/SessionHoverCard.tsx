import { memo } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, FolderGit2, GitBranch } from 'lucide-react'
import { sessionDiffTotals } from '@/features/session/lib/session-ui'
import { StatusIcon } from '@/features/session/components/SessionStatusIcon'
import { getAgentConfig } from '@/shared/lib/agent-config'
import type { AgentSession } from '@akari/shared-types'

interface SessionHoverCardProps {
  session: AgentSession
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

  return (
    <div className="space-y-2 text-xs">
      {/* 标题行：状态 + 名称 + Agent 图标 */}
      <div className="flex items-center gap-2">
        <StatusIcon status={session.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{session.name}</span>
        <AgentIcon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      </div>

      {/* 分支 → 基准 */}
      <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <GitBranch className="h-3 w-3 shrink-0" />
        <span className="truncate">{session.branchName || '—'}</span>
        {!session.isMain && session.baseBranch && (
          <>
            <span className="shrink-0 opacity-50">→</span>
            <span className="truncate">{session.baseBranch}</span>
          </>
        )}
      </div>

      {/* 领先/落后 */}
      {hasUpstream && (
        <div className="flex items-center gap-2 text-[11px]">
          {synced ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              已与上游同步
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {ab!.behind > 0 && (
                <span className="flex items-center gap-0.5 text-amber-500">
                  <ArrowDown className="h-3 w-3" />
                  {ab!.behind}
                </span>
              )}
              {ab!.ahead > 0 && (
                <span className="flex items-center gap-0.5 text-sky-500">
                  <ArrowUp className="h-3 w-3" />
                  {ab!.ahead}
                </span>
              )}
            </span>
          )}
          <span className="truncate text-muted-foreground">相对 {ab!.ref}</span>
        </div>
      )}

      {/* 未提交改动 */}
      {(additions > 0 || deletions > 0) && (
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {additions > 0 && <span className="text-green-500">+{additions}</span>}
          {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
          <span className="text-muted-foreground">未提交改动</span>
        </div>
      )}

      {/* worktree 路径 */}
      {session.worktreePath && (
        <div className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <FolderGit2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-all font-mono">{session.worktreePath}</span>
        </div>
      )}

      {/* 任务描述预览 */}
      {session.task && (
        <p className="line-clamp-2 leading-snug text-muted-foreground">{session.task}</p>
      )}
    </div>
  )
})
