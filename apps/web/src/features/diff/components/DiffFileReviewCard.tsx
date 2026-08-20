import { forwardRef, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, GitCompare } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine } from '@akari/shared-types'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useDiffReviewStore } from '../stores/diff-review-store'
import { highlightCodeLines } from '../lib/diff-highlight'

export interface DiffFileReviewCardProps {
  sessionId: string
  filePath: string
  status: DiffFile['status']
  additions: number
  deletions: number
  hunks: DiffHunk[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  expandBodyVersion?: number
  expandAllVersion: number
  collapseAllVersion: number
  onOpenInDiffEditor: () => void
  onOpenInFileEditor: () => void
}

const CONTEXT_FOLD_THRESHOLD = 10
const CONTEXT_FOLD_BUFFER = 6

type RenderItem =
  | { type: 'line'; line: DiffLine }
  | { type: 'fold'; lines: DiffLine[]; foldIndex: number }

function buildFoldedItems(lines: DiffLine[], threshold: number, buffer: number): RenderItem[] {
  const result: RenderItem[] = []
  let i = 0
  let foldIndex = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line || line.type !== 'context') {
      result.push({ type: 'line', line })
      i++
      continue
    }
    const runStart = i
    while (i < lines.length && lines[i]?.type === 'context') {
      i++
    }
    const runLength = i - runStart
    if (runLength < threshold) {
      for (let j = runStart; j < i; j++) {
        result.push({ type: 'line', line: lines[j]! })
      }
      continue
    }
    const headEnd = Math.min(runStart + buffer, i)
    for (let j = runStart; j < headEnd; j++) {
      result.push({ type: 'line', line: lines[j]! })
    }
    const tailStart = Math.max(headEnd, i - buffer)
    const foldedLines: DiffLine[] = []
    for (let j = headEnd; j < tailStart; j++) {
      foldedLines.push(lines[j]!)
    }
    if (foldedLines.length > 0) {
      result.push({ type: 'fold', lines: foldedLines, foldIndex })
      foldIndex++
    }
    for (let j = tailStart; j < i; j++) {
      result.push({ type: 'line', line: lines[j]! })
    }
  }
  return result
}

function statusColor(status?: DiffFile['status']): string {
  if (status === 'A') return 'text-green-500'
  if (status === 'D') return 'text-red-500'
  if (status === 'R') return 'text-blue-400'
  return 'text-amber-400'
}

function statusLabel(status?: DiffFile['status']): string {
  if (status === 'A') return '新增'
  if (status === 'D') return '删除'
  if (status === 'R') return '重命名'
  return '修改'
}

function DiffLineRow({ line, html }: { line: DiffLine; html?: string }) {
  return (
    <div
      className={cn(
        'flex',
        line.type === 'added' && 'bg-green-500/8',
        line.type === 'removed' && 'bg-red-500/8',
      )}
    >
      <span className="w-10 shrink-0 select-none text-right text-muted-foreground/50">
        {line.oldLineNumber ?? ''}
      </span>
      <span className="w-10 shrink-0 select-none text-right text-muted-foreground/50">
        {line.newLineNumber ?? ''}
      </span>
      <span
        className={cn(
          'w-4 shrink-0 select-none text-center',
          line.type === 'added' && 'text-green-500',
          line.type === 'removed' && 'text-red-400',
          line.type === 'context' && 'text-muted-foreground/40',
        )}
      >
        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
      </span>
      {html === undefined ? (
        <pre className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all px-2 py-0.5 text-foreground/90">
          {line.content}
        </pre>
      ) : (
        <pre
          className="min-w-0 flex-1 select-text whitespace-pre-wrap break-all px-2 py-0.5 text-foreground/90"
          // html 来自 highlight.js（内部已转义源码），安全；空行用 &nbsp; 保持行高
          dangerouslySetInnerHTML={{ __html: html === '' ? '&nbsp;' : html }}
        />
      )}
    </div>
  )
}

export const DiffFileReviewCard = forwardRef<HTMLDivElement, DiffFileReviewCardProps>(function DiffFileReviewCard(
  {
    sessionId,
    filePath,
    status,
    additions,
    deletions,
    hunks,
    loading = false,
    error = null,
    onRetry,
    expandBodyVersion,
    expandAllVersion,
    collapseAllVersion,
    onOpenInDiffEditor,
    onOpenInFileEditor,
  },
  ref,
) {
  const viewed = useDiffReviewStore((s) => s.getFileViewed(sessionId, filePath))
  const setFileViewed = useDiffReviewStore((s) => s.setFileViewed)
  const [bodyExpanded, setBodyExpanded] = useState(!viewed)
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(new Set())

  useEffect(() => {
    setBodyExpanded(!viewed)
  }, [viewed])

  useEffect(() => {
    if (expandBodyVersion === undefined) return
    setBodyExpanded(true)
  }, [expandBodyVersion])

  // 展开全部：展开 body + 展开所有折叠段。hunks 异步到达时若此前点过展开全部则补齐折叠段；
  // 否则（首次加载）保持当前 body 展开态与默认收起折叠，不强制展开「已查看」的卡片。
  useEffect(() => {
    if (expandAllVersion <= 0) return
    setBodyExpanded(true)
    const totalFolds = hunks.reduce((sum, hunk) => {
      const items = buildFoldedItems(hunk.lines, CONTEXT_FOLD_THRESHOLD, CONTEXT_FOLD_BUFFER)
      return sum + items.filter((item) => item.type === 'fold').length
    }, 0)
    setExpandedFolds(new Set(Array.from({ length: totalFolds }, (_, i) => i)))
  }, [expandAllVersion, hunks])

  useEffect(() => {
    setBodyExpanded(false)
    setExpandedFolds(new Set())
  }, [collapseAllVersion])

  const handleToggleFold = (foldIndex: number) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev)
      if (next.has(foldIndex)) {
        next.delete(foldIndex)
      } else {
        next.add(foldIndex)
      }
      return next
    })
  }

  const renderedHunks = useMemo(() => {
    return hunks.map((hunk) => {
      const highlighted = highlightCodeLines(
        hunk.lines.map((line) => line.content),
        filePath,
      )
      const htmlByLine = highlighted
        ? new Map(hunk.lines.map((line, i) => [line, highlighted[i] ?? ''] as const))
        : null
      return {
        hunk,
        htmlByLine,
        items: buildFoldedItems(hunk.lines, CONTEXT_FOLD_THRESHOLD, CONTEXT_FOLD_BUFFER),
      }
    })
  }, [hunks, filePath])

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-lg border bg-card transition-opacity',
        viewed && 'opacity-60',
      )}
    >
      <div
        className={cn(
          'sticky top-0 z-20 flex cursor-pointer items-center gap-2 rounded-t-lg border-b px-3 py-2 transition-colors select-none',
          bodyExpanded ? 'bg-muted' : 'bg-card hover:bg-muted',
        )}
        onClick={() => setBodyExpanded((v) => !v)}
      >
        <Button
          size="icon-xs"
          variant="ghost"
          className="h-5 w-5 shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            setBodyExpanded((v) => !v)
          }}
        >
          {bodyExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </Button>

        <span className={cn('text-xs font-medium', statusColor(status))}>
          {statusLabel(status)}
        </span>

        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs',
            viewed && 'text-muted-foreground line-through',
          )}
          title={filePath}
        >
          {filePath}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] leading-none">
          {additions > 0 && <span className="text-green-500">+{additions}</span>}
          {deletions > 0 && <span className="text-red-400">-{deletions}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onOpenInFileEditor()
            }}
            title="在文件编辑器中打开"
          >
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onOpenInDiffEditor()
            }}
            title="在 Diff 编辑器中打开"
          >
            <GitCompare className="h-3.5 w-3.5" />
          </Button>

          <label
            className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[10px] hover:bg-muted"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={viewed}
              onCheckedChange={() => setFileViewed(sessionId, filePath, !viewed)}
              aria-label="已查看"
            />
            <span className={cn('select-none', viewed && 'text-muted-foreground')}>已查看</span>
          </label>
        </div>
      </div>

      {bodyExpanded && (
        <div className="rounded-b-lg font-mono text-xs">
          {loading && hunks.length === 0 && (
            <div className="px-3 py-4 text-center text-muted-foreground">加载 diff 中…</div>
          )}
          {!loading && error && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-center text-red-400">
              <span>加载失败：{error}</span>
              <button
                className="text-muted-foreground underline hover:text-foreground"
                onClick={() => onRetry?.()}
              >
                重试
              </button>
            </div>
          )}
          {!loading && !error && hunks.length === 0 && (
            <div className="px-3 py-4 text-center text-muted-foreground">无 diff 内容</div>
          )}
          {renderedHunks.map(({ hunk, htmlByLine, items }, hunkIndex) => {
            let globalFoldIndex = 0
            for (let i = 0; i < hunkIndex; i++) {
              globalFoldIndex += renderedHunks[i]?.items.filter((item) => item.type === 'fold').length ?? 0
            }

            return (
              <div key={hunk.id} className="border-b border-border/30 last:border-b-0">
                <div className="sticky top-0 z-10 bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@{hunk.header}
                </div>
                <div>
                  {items.map((item, idx) => {
                    if (item.type === 'fold') {
                      const foldIndex = globalFoldIndex + item.foldIndex
                      const expanded = expandedFolds.has(foldIndex)
                      return (
                        <div key={`fold-${idx}`}>
                          <button
                            className="flex w-full items-center justify-center gap-1 py-1 text-[11px] text-muted-foreground hover:bg-muted/50"
                            onClick={() => handleToggleFold(foldIndex)}
                          >
                            {expanded ? (
                              <><ChevronDown className="h-3 w-3" /> 折叠 {item.lines.length} 行</>
                            ) : (
                              <><ChevronRight className="h-3 w-3" /> 省略 {item.lines.length} 行</>
                            )}
                          </button>
                          {expanded && item.lines.map((line, lineIdx) => (
                            <DiffLineRow key={`fold-line-${idx}-${lineIdx}`} line={line} html={htmlByLine?.get(line)} />
                          ))}
                        </div>
                      )
                    }

                    return <DiffLineRow key={`line-${idx}`} line={item.line} html={htmlByLine?.get(item.line)} />
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

export { buildFoldedItems }
