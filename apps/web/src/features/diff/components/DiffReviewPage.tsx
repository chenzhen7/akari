import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile, DiffHunk } from '@akari/shared-types'
import { apiClient } from '@/shared/lib/api-client'
import { useTabStore } from '@/features/session/stores/tab-store'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'
import { useDiffReviewStore } from '../stores/diff-review-store'
import { DiffFileReviewCard } from './DiffFileReviewCard'
import { DiffReviewToolbar } from './DiffReviewToolbar'

interface DiffReviewPageProps {
  sessionId: string
  diffFiles: DiffFile[]
}

export function DiffReviewPage({
  sessionId,
  diffFiles,
}: DiffReviewPageProps) {
  const [hunksByFile, setHunksByFile] = useState<Record<string, DiffHunk[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandAllVersion, setExpandAllVersion] = useState(0)
  const [collapseAllVersion, setCollapseAllVersion] = useState(0)
  const [perFileExpandVersion, setPerFileExpandVersion] = useState<Record<string, number>>({})
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const pendingScrollTargetRef = useRef<string | null>(null)

  const setFileViewed = useDiffReviewStore((s) => s.setFileViewed)
  const sessionReviewState = useDiffReviewStore((s) => s.states[sessionId])
  const reconcileSession = useDiffReviewStore((s) => s.reconcileSession)
  const scrollTarget = useDiffReviewStore((s) => s.getScrollTarget(sessionId))

  const createTab = useTabStore((s) => s.createTab)

  const filePaths = useMemo(() => diffFiles.map((f) => f.path), [diffFiles])

  useEffect(() => {
    reconcileSession(sessionId, filePaths)
  }, [sessionId, filePaths, reconcileSession])

  const loadHunks = () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    apiClient
      .get<{ hunksByFile?: Record<string, DiffHunk[]> }>(`/sessions/${sessionId}/diff-hunks`, {
        toast: false,
      })
      .then((data) => {
        setHunksByFile(data.hunksByFile ?? {})
      })
      .catch((e: unknown) => {
        setError(String(e))
      })
      .finally(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    loadHunks()
  }, [sessionId])

  useEffect(() => {
    return fileUpdateBus.on(sessionId, () => {
      loadHunks()
    })
  }, [sessionId])

  const scrollToFile = useCallback((filePath: string) => {
    const el = cardRefs.current[filePath]
    if (!el) {
      pendingScrollTargetRef.current = filePath
      return false
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    pendingScrollTargetRef.current = null
    return true
  }, [])

  useEffect(() => {
    if (!scrollTarget) return
    const { filePath } = scrollTarget

    setPerFileExpandVersion((prev) => ({
      ...prev,
      [filePath]: (prev[filePath] ?? 0) + 1,
    }))

    // Try scrolling immediately, then retry a few times in case the card
    // is still mounting or the container has just been swapped in.
    requestAnimationFrame(() => {
      if (scrollToFile(filePath)) return
      const attempts = [50, 100, 200, 400]
      let idx = 0
      const tryScroll = () => {
        if (scrollToFile(filePath)) return
        idx++
        if (idx < attempts.length) {
          setTimeout(tryScroll, attempts[idx])
        }
      }
      setTimeout(tryScroll, attempts[0])
    })
  }, [scrollTarget, scrollToFile])

  // Retry pending scroll target when hunks arrive (cards are guaranteed rendered).
  useEffect(() => {
    const pending = pendingScrollTargetRef.current
    if (!pending) return
    if (!cardRefs.current[pending]) return
    scrollToFile(pending)
  }, [hunksByFile, scrollToFile])

  const viewedCount = useMemo(() => {
    return diffFiles.filter((f) => sessionReviewState?.[f.path]?.viewed).length
  }, [diffFiles, sessionReviewState])

  const handleMarkAllViewed = () => {
    for (const file of diffFiles) {
      setFileViewed(sessionId, file.path, true)
    }
  }

  const handleMarkAllUnviewed = () => {
    for (const file of diffFiles) {
      setFileViewed(sessionId, file.path, false)
    }
  }

  const handleExpandAll = () => {
    setExpandAllVersion((v) => v + 1)
  }

  const handleCollapseAll = () => {
    setCollapseAllVersion((v) => v + 1)
  }

  const handleOpenInDiffEditor = (filePath: string) => {
    createTab(sessionId, 'diff', filePath)
  }

  const handleOpenInFileEditor = (filePath: string) => {
    createTab(sessionId, 'file', filePath)
  }

  if (diffFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-sm">暂无变更</p>
        <p className="text-xs opacity-60">在右侧「变更」面板可查看文件列表</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DiffReviewToolbar
        files={diffFiles}
        viewedCount={viewedCount}
        onMarkAllViewed={handleMarkAllViewed}
        onMarkAllUnviewed={handleMarkAllUnviewed}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
      />

      <div className="flex-1 overflow-auto">
        <div className="space-y-3 p-3">
          {loading && diffFiles.length > 0 && Object.keys(hunksByFile).length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">加载 diff 中…</div>
          )}
          {error && (
            <div className="py-8 text-center text-sm text-red-400">
              加载失败：{error}
            </div>
          )}
          {diffFiles.map((file) => {
            const hunks = hunksByFile[file.path] ?? []
            return (
              <DiffFileReviewCard
                key={file.path}
                ref={(el) => {
                  cardRefs.current[file.path] = el
                }}
                sessionId={sessionId}
                filePath={file.path}
                status={file.status}
                additions={file.additions}
                deletions={file.deletions}
                hunks={hunks}
                expandBodyVersion={perFileExpandVersion[file.path]}
                expandAllVersion={expandAllVersion}
                collapseAllVersion={collapseAllVersion}
                onOpenInDiffEditor={() => handleOpenInDiffEditor(file.path)}
                onOpenInFileEditor={() => handleOpenInFileEditor(file.path)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
