import { CheckCheck, EyeOff, Expand, FoldVerticalIcon } from 'lucide-react'
import type { DiffFile } from '@akari/shared-types'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Progress } from '@/shared/components/ui/progress'

interface DiffReviewToolbarProps {
  files: DiffFile[]
  viewedCount: number
  onMarkAllViewed: () => void
  onMarkAllUnviewed: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  className?: string
}

export function DiffReviewToolbar({
  files,
  viewedCount,
  onMarkAllViewed,
  onMarkAllUnviewed,
  onExpandAll,
  onCollapseAll,
  className,
}: DiffReviewToolbarProps) {
  const totalCount = files.length
  const progress = totalCount > 0 ? Math.round((viewedCount / totalCount) * 100) : 0
  const hasFiles = totalCount > 0

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-3 border-b border-border bg-muted/30 px-3 py-2',
        className,
      )}
    >
      <div className="flex w-32 flex-col gap-0.5">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>审查进度</span>
          <span>{viewedCount}/{totalCount}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          size="xs"
          variant="outline"
          className="h-6 gap-1 text-[10px]"
          disabled={!hasFiles}
          onClick={onMarkAllViewed}
          title="全部标记为已查看"
        >
          <CheckCheck className="h-3 w-3" />
          全部已查看
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="h-6 gap-1 text-[10px]"
          disabled={!hasFiles}
          onClick={onMarkAllUnviewed}
          title="全部标记为未读"
        >
          <EyeOff className="h-3 w-3" />
          全部未读
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 gap-1 text-[10px]"
          disabled={!hasFiles}
          onClick={onExpandAll}
          title="展开所有卡片和省略区域"
        >
          <Expand className="h-3 w-3" />
          展开所有
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 gap-1 text-[10px]"
          disabled={!hasFiles}
          onClick={onCollapseAll}
          title="折叠所有省略区域"
        >
          <FoldVerticalIcon className="h-3 w-3" />
          折叠所有
        </Button>
      </div>
    </div>
  )
}
