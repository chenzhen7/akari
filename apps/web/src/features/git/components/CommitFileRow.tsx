import type { DiffFile } from '@akari/shared-types'
import { Loader2 } from 'lucide-react'
import { ROW_H } from '@/features/git/lib/git-graph-utils'
import { FileTypeIcon } from '@/shared/components/file-icon'
import { statusBadgeClass } from '@/features/diff/components/DiffFileTreeNode'
import { cn } from '@/shared/lib/utils'

interface CommitFileRowProps {
  file: DiffFile
  top: number
  graphWidth: number
  onOpen: (path: string) => void
}

/**
 * Git 图行内展开的一个文件行：左侧图形占位列透出泳道线，右侧状态字母 + 路径 + 增删计数。
 * 点击整行打开该文件在此提交中的 diff。
 */
export function CommitFileRow({ file, top, graphWidth, onOpen }: CommitFileRowProps) {
  return (
    <div
      className="absolute left-0 right-0 flex cursor-pointer items-center text-xs hover:bg-muted/40"
      style={{ top, height: ROW_H }}
      onClick={() => onOpen(file.path)}
      title={`${file.status} ${file.path}`}
    >
      <div className="grid w-full items-center" style={{ gridTemplateColumns: `${graphWidth}px 1fr` }}>
        {/* 图形占位列：透明，让泳道线贯穿展开区 */}
        <div className="relative h-full" />
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden pl-1 pr-2">
          <span className={cn('w-4 shrink-0 text-center text-[10px] font-semibold', statusBadgeClass(file.status))}>
            {file.status}
          </span>
          <FileTypeIcon fileName={file.path} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{file.path}</span>
          {file.additions > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-green-500">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-red-400">-{file.deletions}</span>
          )}
        </div>
      </div>
    </div>
  )
}

interface CommitFilePlaceholderRowProps {
  top: number
  graphWidth: number
  status: 'loading' | 'error' | 'empty'
  onRetry?: () => void
}

/** 展开提交时的占位行：加载中 / 加载失败（可重试） / 空提交。 */
export function CommitFilePlaceholderRow({ top, graphWidth, status, onRetry }: CommitFilePlaceholderRowProps) {
  return (
    <div className="absolute left-0 right-0 flex items-center text-xs" style={{ top, height: ROW_H }}>
      <div className="grid w-full items-center" style={{ gridTemplateColumns: `${graphWidth}px 1fr` }}>
        <div className="relative h-full" />
        <div className="flex min-w-0 items-center gap-2 pl-1 pr-2 text-muted-foreground">
          {status === 'loading' && (
            <>
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              <span className="text-[11px]">加载文件列表…</span>
            </>
          )}
          {status === 'error' && (
            <>
              <span className="text-[11px] text-red-400">加载失败</span>
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                onClick={onRetry}
              >
                重试
              </button>
            </>
          )}
          {status === 'empty' && <span className="text-[11px]">此提交无文件改动</span>}
        </div>
      </div>
    </div>
  )
}
