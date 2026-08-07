import type { DiffFile } from '@akari/shared-types'
import { useFileDiffHunks } from '../hooks/useFileDiffHunks'
import { DiffFileReviewCard } from './DiffFileReviewCard'

export interface LazyDiffFileCardProps {
  sessionId: string
  file: DiffFile
  expandBodyVersion?: number
  expandAllVersion: number
  collapseAllVersion: number
  onOpenInDiffEditor: (filePath: string) => void
  onOpenInFileEditor: (filePath: string) => void
  /** 滚动定位用：把卡片根元素登记到父级的 ref 表 */
  onCardRef: (filePath: string, el: HTMLDivElement | null) => void
}

/**
 * 惰性 diff 卡片：hunks 按需拉取（滚到附近才发 `diff-hunks?file=`），
 * 文件在工作树变化时自动重拉。渲染交给 DiffFileReviewCard。
 */
export function LazyDiffFileCard({
  sessionId,
  file,
  expandBodyVersion,
  expandAllVersion,
  collapseAllVersion,
  onOpenInDiffEditor,
  onOpenInFileEditor,
  onCardRef,
}: LazyDiffFileCardProps) {
  const { hunks, loading, error, elementRef, retry } = useFileDiffHunks(sessionId, file.path)

  return (
    <div
      ref={(el) => {
        elementRef(el)
        onCardRef(file.path, el)
      }}
    >
      <DiffFileReviewCard
        sessionId={sessionId}
        filePath={file.path}
        status={file.status}
        additions={file.additions}
        deletions={file.deletions}
        hunks={hunks}
        loading={loading}
        error={error}
        onRetry={retry}
        expandBodyVersion={expandBodyVersion}
        expandAllVersion={expandAllVersion}
        collapseAllVersion={collapseAllVersion}
        onOpenInDiffEditor={() => onOpenInDiffEditor(file.path)}
        onOpenInFileEditor={() => onOpenInFileEditor(file.path)}
      />
    </div>
  )
}
