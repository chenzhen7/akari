import { cn } from '@/shared/lib/utils'
import { statusIconMap } from '@/features/session/lib/session-ui'

export function StatusIcon({ status }: { status: string }) {
  if (status === 'idle') {
    return <div className="mt-0.5 h-3 w-3 shrink-0" />
  }
  const { Icon, color } = statusIconMap[status] ?? statusIconMap.initializing
  const isSpinning = status === 'running' || status === 'initializing'
  return <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', color, isSpinning && 'animate-spin')} />
}
