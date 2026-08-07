import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffHunk } from '@akari/shared-types'
import { apiClient } from '@/shared/lib/api-client'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'

export interface UseFileDiffHunksResult {
  hunks: DiffHunk[]
  loading: boolean
  error: string | null
  /** 挂到卡片根元素上，IntersectionObserver 用它判断「滚到附近」才发起请求 */
  elementRef: (el: HTMLDivElement | null) => void
  retry: () => void
}

/**
 * 按需加载单个文件的 diff hunks。
 *
 * - IntersectionObserver（rootMargin 400px）：卡片滚入视口附近才发 `GET /diff-hunks?file=`，
 *   避免 DiffReview 页一次性并发 N 个文件的全量拉取。
 * - 该文件在工作树中变化时（fileUpdateBus 匹配 filePath）debounce 500ms 重拉。
 * - AbortController 取消陈旧请求，防止快速滚动时旧响应覆盖新数据。
 */
export function useFileDiffHunks(sessionId: string, filePath: string): UseFileDiffHunksResult {
  const [hunks, setHunks] = useState<DiffHunk[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    if (!sessionId) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    apiClient
      .get<{ hunks: DiffHunk[] }>(`/sessions/${sessionId}/diff-hunks`, {
        toast: false,
        params: { file: filePath },
        signal: controller.signal,
      })
      .then((data) => {
        if (controller.signal.aborted) return
        setHunks(data.hunks ?? [])
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
  }, [sessionId, filePath])

  // 滚到附近才拉；不支持 IntersectionObserver 的环境直接拉
  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            load()
            observer.disconnect()
          }
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [load])

  // 本文件在工作树中变化 → debounce 500ms 重拉
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = fileUpdateBus.on(sessionId, (payload) => {
      if (payload.filePath !== filePath) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        abortRef.current?.abort()
        load()
      }, 500)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [sessionId, filePath, load])

  useEffect(() => () => abortRef.current?.abort(), [])

  return {
    hunks,
    loading,
    error,
    elementRef: (el) => {
      elementRef.current = el
    },
    retry: load,
  }
}
