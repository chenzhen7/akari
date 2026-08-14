import {
  Archive,
  CheckCircle2,
  Clock,
  Coffee,
  Eye,
  Loader2,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { AgentSession } from '@/shared/types'

export const statusIconMap: Record<string, { Icon: LucideIcon; color: string }> = {
  running: { Icon: Loader2, color: 'text-green-500' },
  idle: { Icon: Coffee, color: 'text-sky-500' },
  waiting: { Icon: Clock, color: 'text-amber-500' },
  failed: { Icon: XCircle, color: 'text-red-500' },
  completed: { Icon: CheckCircle2, color: 'text-blue-500' },
  initializing: { Icon: Loader2, color: 'text-slate-400' },
  paused: { Icon: PauseCircle, color: 'text-orange-500' },
  review: { Icon: Eye, color: 'text-purple-500' },
  archived: { Icon: Archive, color: 'text-slate-500' },
}

/** 会话 diff 合计：优先按 diffFiles 求和（与变更列表同源），未加载时回退 DB 里的 diffSummary */
export function sessionDiffTotals(session: AgentSession): { additions: number; deletions: number } {
  if (session.diffFiles) {
    return session.diffFiles.reduce(
      (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
      { additions: 0, deletions: 0 },
    )
  }
  return { additions: session.diffSummary?.additions ?? 0, deletions: session.diffSummary?.deletions ?? 0 }
}
