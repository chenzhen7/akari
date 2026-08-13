import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react'
import { ChevronDown, ChevronUp, Loader2, Undo2, X } from 'lucide-react'
import type { editor } from 'monaco-editor'
import { apiClient } from '@/shared/lib/api-client'
import { toast } from '@/shared/lib/toast'
import { detectLanguage } from '@/shared/lib/language-utils'
import { useMonacoTheme } from '@/shared/hooks/useMonacoTheme'
import { Button } from '@/shared/components/ui/button'
import { getGutterColor, type QuickDiffChange } from '../lib/diff-gutter'

const PEEK_HEIGHT = 320

export interface QuickDiffPeekProps {
  sessionId: string
  filePath: string
  changes: QuickDiffChange[]
  currentIndex: number
  anchorLine: number
  /** 承载该浮层的宿主 Monaco 编辑器（用于坐标计算与滚动跟随）。 */
  hostEditor: editor.IStandaloneCodeEditor
  onClose: () => void
  onNavigate: (index: number) => void
  /** 回滚当前变更成功后的回调（宿主负责重载文件内容与 diff）。 */
  onRevertSuccess: () => void
}

/**
 * 点击 gutter 差异标记后弹出的对比浮层（参考 VSCode QuickDiffWidget）：
 * 锚定在点击的行附近，内嵌一个 inline（统一视图）Diff 编辑器，支持
 * Alt+F3 / Shift+Alt+F3 在变更间跳转、Esc 关闭。
 */
export function QuickDiffPeek({
  sessionId,
  filePath,
  changes,
  currentIndex,
  anchorLine,
  hostEditor,
  onClose,
  onNavigate,
  onRevertSuccess,
}: QuickDiffPeekProps) {
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [top, setTop] = useState(0)
  const [reverting, setReverting] = useState(false)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const monacoTheme = useMonacoTheme()

  // 边框/光晕颜色跟随当前变更类型（新增绿 / 修改蓝 / 删除红），导航时随 currentIndex 更新
  const currentChange = changes[currentIndex]
  const frameColor = getGutterColor(currentChange?.type ?? 'modified', monacoTheme === 'vs-dark' ? 'dark' : 'light')

  // 最新值同步到 ref，供一次性挂载的 onDidUpdateDiff / reveal 回调读取最新索引
  const changesRef = useRef(changes)
  const indexRef = useRef(currentIndex)
  useEffect(() => {
    changesRef.current = changes
  }, [changes])
  useEffect(() => {
    indexRef.current = currentIndex
  }, [currentIndex])

  const load = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    apiClient
      .get<{ original: string; modified: string }>(`/sessions/${sessionId}/diff-content`, {
        params: { file: filePath },
        signal: controller.signal,
        toast: false,
      })
      .then((data) => {
        if (controller.signal.aborted) return
        setContent(data)
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
      })
  }, [sessionId, filePath])

  useEffect(() => {
    load()
    return () => abortRef.current?.abort()
  }, [load, reloadKey])

  const retry = useCallback(() => {
    setLoading(true)
    setError(null)
    setContent(null)
    setReloadKey((k) => k + 1)
  }, [])

  // 回滚当前变更块（git apply -R，服务端只还原该 hunk、保留其他改动）
  const handleRevert = useCallback(async () => {
    const change = changesRef.current[indexRef.current]
    if (!change) return
    setReverting(true)
    try {
      await apiClient.post(
        `/sessions/${sessionId}/git/revert-change`,
        { filePath, line: change.lineNumber },
        { toast: '回滚失败' },
      )
      toast.success('已回滚当前变更')
      onRevertSuccess()
    } catch (err) {
      console.error('[QuickDiffPeek] revert failed:', err)
    } finally {
      setReverting(false)
    }
  }, [sessionId, filePath, onRevertSuccess])

  // 锚点跟随宿主编辑器滚动 / 尺寸变化；首次定位放 rAF，避免 effect 内同步 setState
  const updateTop = useCallback(() => {
    const layout = hostEditor.getLayoutInfo()
    const visibleTop = hostEditor.getTopForLineNumber(anchorLine) - hostEditor.getScrollTop()
    const maxTop = Math.max(0, layout.height - PEEK_HEIGHT)
    setTop(Math.min(Math.max(0, visibleTop), maxTop))
  }, [hostEditor, anchorLine])

  useEffect(() => {
    const raf = requestAnimationFrame(() => updateTop())
    const scrollSub = hostEditor.onDidScrollChange(() => updateTop())
    const layoutSub = hostEditor.onDidLayoutChange(() => updateTop())
    return () => {
      cancelAnimationFrame(raf)
      scrollSub.dispose()
      layoutSub.dispose()
    }
  }, [hostEditor, updateTop])

  // 在 inline diff 的 modified 编辑器中定位到当前变更行
  const reveal = useCallback(() => {
    const diffEditor = diffEditorRef.current
    const monaco = monacoRef.current
    const change = changesRef.current[indexRef.current]
    if (!diffEditor || !monaco || !change) return
    const modified = diffEditor.getModifiedEditor()
    const { lineNumber, type } = change
    let start = lineNumber
    let end = lineNumber
    if (type === 'removed') {
      end = lineNumber + 1
    } else if (type === 'modified') {
      start = Math.max(1, lineNumber - 1)
      end = lineNumber + 1
    }
    modified.revealLinesInCenter(start, end, monaco.editor.ScrollType.Immediate)
  }, [])

  const handleDiffMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => {
      diffEditorRef.current = diffEditor
      monacoRef.current = monaco
      diffEditor.onDidUpdateDiff(() => reveal())
      reveal()
    },
    [reveal],
  )

  useEffect(() => {
    reveal()
  }, [reveal, currentIndex])

  const nextIndex = (currentIndex + 1) % changes.length
  const prevIndex = (currentIndex - 1 + changes.length) % changes.length
  const basename = filePath.split(/[\\/]/).pop() ?? filePath

  // Esc 关闭 / Alt+F3 下一个 / Shift+Alt+F3 上一个（window 级，不依赖 Monaco 焦点）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'F3' && e.altKey && !e.shiftKey) {
        e.preventDefault()
        onNavigate(nextIndex)
      } else if (e.key === 'F3' && e.altKey && e.shiftKey) {
        e.preventDefault()
        onNavigate(prevIndex)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onNavigate, nextIndex, prevIndex])

  return (
    <div
      className="absolute left-0 right-0 z-30 flex flex-col overflow-hidden rounded-md border-2 bg-card"
      style={{
        top,
        height: PEEK_HEIGHT,
        borderColor: frameColor,
        boxShadow: `0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 3px ${frameColor}40`,
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[11px]">
        <span className="truncate font-mono text-foreground/90">{basename}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">
          {currentIndex + 1} / {changes.length} 处变更
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          className="h-5 w-5 shrink-0"
          title="上一个变更 (Shift+Alt+F3)"
          onClick={() => onNavigate(prevIndex)}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="h-5 w-5 shrink-0"
          title="下一个变更 (Alt+F3)"
          onClick={() => onNavigate(nextIndex)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="h-5 w-5 shrink-0 text-muted-foreground hover:text-red-500"
          title="回滚当前变更"
          disabled={reverting}
          onClick={() => void handleRevert()}
        >
          {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="h-5 w-5 shrink-0"
          title="关闭 (Esc)"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1">
        {loading && !content && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            加载 diff 中…
          </div>
        )}
        {!loading && error && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-red-400">
            <span>加载失败：{error}</span>
            <button
              className="text-muted-foreground underline hover:text-foreground"
              onClick={retry}
            >
              重试
            </button>
          </div>
        )}
        {content && (
          <MonacoDiffEditor
            height="100%"
            language={detectLanguage(filePath)}
            original={content.original}
            modified={content.modified}
            theme={monacoTheme}
            onMount={handleDiffMount}
            options={{
              readOnly: true,
              renderSideBySide: false,
              ignoreTrimWhitespace: false,
              minimap: { enabled: false },
              renderOverviewRuler: false,
              renderIndicators: false,
              scrollBeyondLastLine: false,
              fontSize: 12,
              lineNumbers: 'on',
              padding: { top: 8, bottom: 8 },
              diffWordWrap: 'on',
              stickyScroll: { enabled: false },
            }}
          />
        )}
      </div>
    </div>
  )
}
