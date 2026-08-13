import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { Editor as MonacoEditor } from '@monaco-editor/react'
import { toast } from '@/shared/lib/toast'
import type { FileDiffLine } from '@akari/shared-types'
import type { editor } from 'monaco-editor'
import { apiClient } from '@/shared/lib/api-client'
import { detectLanguage } from '@/shared/lib/language-utils'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'
import { useMonacoTheme } from '@/shared/hooks/useMonacoTheme'
import { useAbsoluteFilePath } from '@/shared/hooks/useAbsoluteFilePath'
import { EditorContainer } from '@/shared/components/EditorContainer'
import { perfMark, perfMeasure } from '@/shared/lib/perf-log'
import { buildQuickDiffChanges, getGlyphClassName, getGutterTooltip, GUTTER_COLORS } from '../lib/diff-gutter'
import { QuickDiffPeek } from './QuickDiffPeek'

const AUTO_SAVE_DELAY = 800

interface FileEditorProps {
  sessionId: string
  workspaceId: string
  worktreePath: string
  filePath: string
  isActive?: boolean
}

export const FileEditor = memo(function FileEditor({ sessionId, workspaceId, worktreePath, filePath, isActive }: FileEditorProps) {
  const [content, setContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffLines, setDiffLines] = useState<FileDiffLine[] | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const decorationsRef = useRef<ReturnType<editor.IStandaloneCodeEditor['createDecorationsCollection']> | null>(null)
  const isDirty = content !== originalContent
  const contentRef = useRef(content)
  const isDirtyRef = useRef(isDirty)
  const originalContentRef = useRef(originalContent)
  const isActiveRef = useRef(isActive)
  contentRef.current = content
  isDirtyRef.current = isDirty
  originalContentRef.current = originalContent
  isActiveRef.current = isActive
  const monacoTheme = useMonacoTheme()
  const [peek, setPeek] = useState<{ index: number; anchorLine: number } | null>(null)
  const diffAbortRef = useRef<AbortController | null>(null)
  const diffDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mouseDownLineRef = useRef<number | null>(null)
  const editorDisposablesRef = useRef<{ dispose: () => void }[]>([])
  const changes = useMemo(() => (diffLines ? buildQuickDiffChanges(diffLines) : []), [diffLines])
  const changesRef = useRef(changes)
  const peekRef = useRef(peek)
  changesRef.current = changes
  peekRef.current = peek

  // Fetch diff lines helper — 最新请求胜出：abort 旧的，避免旧响应覆盖新标记
  const fetchDiffLines = useCallback(async () => {
    if (!filePath || !sessionId) return
    diffAbortRef.current?.abort()
    const controller = new AbortController()
    diffAbortRef.current = controller
    perfMark(`diff:${filePath}`, `发起 diff-lines 请求 ${filePath}`)
    try {
      const data = await apiClient.get<{ lines: FileDiffLine[] }>(`/sessions/${sessionId}/diff-lines`, {
        params: { path: filePath },
        signal: controller.signal,
        toast: false,
      })
      if (controller.signal.aborted) return
      perfMeasure(`diff:${filePath}`, `diff-lines 响应返回（HTTP 耗时）`)
      setDiffLines(data.lines)
    } catch (err) {
      if (controller.signal.aborted) return // 已被更新的请求取代，非真实错误
      console.error('[FileEditor] fetch diff lines failed:', err)
    } finally {
      if (diffAbortRef.current === controller) diffAbortRef.current = null
    }
  }, [filePath, sessionId])

  // Apply decorations to Monaco editor（VSCode QuickDiff 风格：linesDecorationsClassName + 主题色）
  const applyDiffDecorations = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor'), lines: FileDiffLine[]) => {
      decorationsRef.current?.clear()

      const palette = GUTTER_COLORS[monacoTheme === 'vs-dark' ? 'dark' : 'light']
      const decorationOptions: editor.IModelDeltaDecoration[] = buildQuickDiffChanges(lines).map((change) => {
        const key = change.type === 'added' ? 'added' : change.type === 'modified' ? 'modified' : 'deleted'
        const isDeleted = change.type === 'removed'
        return {
          range: isDeleted
            ? new monaco.Range(change.lineNumber, Number.MAX_VALUE, change.lineNumber, Number.MAX_VALUE)
            : new monaco.Range(change.lineNumber, 1, change.lineNumber, 1),
          options: {
            description: 'dirty-diff-decoration',
            isWholeLine: !isDeleted,
            linesDecorationsClassName: getGlyphClassName(change.type),
            linesDecorationsTooltip: getGutterTooltip(change.type),
            overviewRuler: { color: palette.overview[key], position: monaco.editor.OverviewRulerLane.Left },
            minimap: { color: palette.minimap[key], position: monaco.editor.MinimapPosition.Gutter },
          },
        }
      })

      decorationsRef.current = editor.createDecorationsCollection(decorationOptions)
    },
    [monacoTheme],
  )

  useEffect(() => {
    if (!filePath || !sessionId) return
    setLoading(true)
    setError(null)
    setContent('')
    setOriginalContent('')
    setDiffLines(null)
    setPeek(null)
    decorationsRef.current?.clear()

    const clickKey = `file:${filePath}`
    const fetchKey = `fetch:${filePath}`
    perfMeasure(clickKey, 'FileEditor 挂载并发起请求（点击 → fetch 开始）')
    perfMark(fetchKey, `发起 file-content 请求 ${filePath}`)

    const controller = new AbortController()
    apiClient.get<{ content: string }>(`/sessions/${sessionId}/file-content`, {
      params: { path: filePath },
      signal: controller.signal,
      toast: false,
    })
      .then(data => {
        perfMeasure(fetchKey, 'file-content 响应返回（HTTP 耗时）')
        setContent(data.content)
        setOriginalContent(data.content)
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setError(String(e))
      })
      .finally(() => setLoading(false))

    // Also fetch diff lines in parallel
    void fetchDiffLines()

    return () => controller.abort()
  }, [filePath, sessionId, fetchDiffLines])

  // Apply diff decorations when diffLines changes and editor is ready.
  // 用 diffLines !== null 判断：diff-lines 返回 []（保存后无差异）时也必须清空旧标记。
  useEffect(() => {
    if (editorRef.current && monacoRef.current && diffLines !== null) {
      applyDiffDecorations(editorRef.current, monacoRef.current, diffLines)
    }
  }, [diffLines, applyDiffDecorations, monacoTheme])

  // Listen for external file changes broadcast from the shared watcher.
  // debounce 500ms：避免 agent 连续写文件时连发 N 个请求，只取最后一次。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = fileUpdateBus.on(sessionId, (event) => {
      if (event.filePath !== filePath) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        apiClient.get<{ content: string }>(`/sessions/${sessionId}/file-content`, {
          params: { path: filePath },
          toast: '重新加载文件失败',
        })
          .then(data => {
            if (data.content === contentRef.current) return // own save or no real change
            if (isDirtyRef.current) {
              toast.warning(`文件已在外部被修改：${filePath}`, {
                description: '您有未保存的更改，请手动保存或放弃修改后刷新。',
              })
              return
            }
            setContent(data.content)
            setOriginalContent(data.content)
            void fetchDiffLines()
          })
          .catch((e: unknown) => console.error('[FileEditor] reload failed:', e))
      }, 500)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [sessionId, filePath, fetchDiffLines])

  const doSave = useCallback(async () => {
    if (!isDirty || saving) return
    setSaving(true)
    try {
      await apiClient.post(`/sessions/${sessionId}/file-content`, { path: filePath, content }, { toast: '保存失败' })
      setOriginalContent(content)
      // Refresh diff gutter after save
      await fetchDiffLines()
    } catch (err) {
      console.error('[FileEditor] auto-save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [content, filePath, isDirty, saving, sessionId, fetchDiffLines])

  // Auto-save on content change (debounced)
  const saveRef = useRef(doSave)
  saveRef.current = doSave

  // Cleanup on unmount or filePath change. Flush pending edits before clearing
  // the debounce timer so switching tabs cannot drop the latest keystrokes.
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
        autoSaveTimer.current = null
      }
      if (isDirtyRef.current && contentRef.current !== originalContentRef.current) {
        apiClient.post(`/sessions/${sessionId}/file-content`, {
          path: filePath,
          content: contentRef.current,
        }, { toast: '保存失败' })
          .catch((err: unknown) => {
            console.error('[FileEditor] flush save on unmount failed:', err)
          })
      }
      if (diffDebounceRef.current) {
        clearTimeout(diffDebounceRef.current)
        diffDebounceRef.current = null
      }
      diffAbortRef.current?.abort()
      for (const d of editorDisposablesRef.current) d.dispose()
      editorDisposablesRef.current = []
      decorationsRef.current?.clear()
      editorRef.current = null
      monacoRef.current = null
    }
  }, [filePath, sessionId])

  // Refocus and relayout the editor when this tab becomes active again.
  // The component is kept alive while hidden, so the editor may have been
  // sized to 0x0 and needs a layout refresh.
  useEffect(() => {
    if (!isActive) return
    const editor = editorRef.current
    if (!editor) return
    try {
      editor.focus()
      editor.layout()
    } catch { /* ignore */ }
  }, [isActive])

  useEffect(() => {
    if (!isDirty || loading || error) return

    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
    }
    autoSaveTimer.current = setTimeout(() => {
      saveRef.current()
    }, AUTO_SAVE_DELAY)

    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
    }
  }, [content, isDirty, loading, error])

  // 点击 gutter diff 标记：mousedown 记录行号，mouseup 确认同一行后打开/关闭对比 peek
  const handleEditorMouseDown = useCallback((e: editor.IEditorMouseEvent) => {
    const monaco = monacoRef.current
    if (!monaco) return
    if (!e.event.leftButton) return
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return
    if (!e.target.element) return
    if (e.target.element.className.indexOf('dirty-diff-glyph') < 0) return
    if (!e.target.range) return
    mouseDownLineRef.current = e.target.range.startLineNumber
  }, [])

  const handleEditorMouseUp = useCallback((e: editor.IEditorMouseEvent) => {
    const line = mouseDownLineRef.current
    mouseDownLineRef.current = null
    if (line === null) return
    const monaco = monacoRef.current
    if (!monaco) return
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) return
    if (!e.target.range || e.target.range.startLineNumber !== line) return
    const idx = changesRef.current.findIndex((c) => c.lineNumber === line)
    if (idx < 0) return
    const open = peekRef.current
    if (open && open.index === idx && open.anchorLine === line) {
      setPeek(null) // 再次点击同一标记关闭
    } else {
      setPeek({ index: idx, anchorLine: line })
    }
  }, [])

  const handlePeekNavigate = useCallback((index: number) => {
    const ch = changesRef.current[index]
    if (!ch) return
    setPeek({ index, anchorLine: ch.lineNumber })
  }, [])

  // 回滚成功（git apply -R 改了磁盘文件）：立即重拉内容 + diff，不依赖 watcher 广播
  const handleReverted = useCallback(() => {
    setPeek(null)
    apiClient.get<{ content: string }>(`/sessions/${sessionId}/file-content`, {
      params: { path: filePath },
      toast: '重新加载文件失败',
    })
      .then((data) => {
        setContent(data.content)
        setOriginalContent(data.content)
        void fetchDiffLines()
      })
      .catch((e: unknown) => console.error('[FileEditor] reload after revert failed:', e))
  }, [sessionId, filePath, fetchDiffLines])

  // diff-lines 刷新后，打开的行若不再是变更点则关闭 peek，否则修正索引
  useEffect(() => {
    if (!peek) return
    const idx = changes.findIndex((c) => c.lineNumber === peek.anchorLine)
    if (idx < 0) {
      setPeek(null)
    } else if (idx !== peek.index) {
      setPeek({ index: idx, anchorLine: peek.anchorLine })
    }
  }, [changes, peek])

  // 编辑内容变化后 debounce 刷新 diff 标记；仅在自动保存已提交（!isDirty）后执行，
  // 避免输入过程中抖动。AUTO_SAVE_DELAY 为 800ms，此处 1200ms > 800ms 兜底。
  const scheduleDiffRefresh = useCallback(() => {
    if (diffDebounceRef.current) clearTimeout(diffDebounceRef.current)
    diffDebounceRef.current = setTimeout(() => {
      diffDebounceRef.current = null
      if (!isDirtyRef.current) void fetchDiffLines()
    }, 1200)
  }, [fetchDiffLines])

  const handleEditorMount = useCallback((_editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = _editor
    monacoRef.current = monaco
    const clickKey = `file:${filePath}`
    perfMeasure(clickKey, 'Monaco 挂载完成（onMount）')
    requestAnimationFrame(() => {
      perfMeasure(clickKey, '文本首帧渲染完成（点击 → 可见总耗时）')
    })
    _editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        doSave()
      }
    )
    // Apply initial diff decorations if already loaded（diffLines 为 null 时跳过，[] 也正确清空）
    if (diffLines !== null) {
      applyDiffDecorations(_editor, monaco, diffLines)
    }
    // 点击 gutter diff 标记 → 打开对比 peek（仿 VSCode QuickDiff 的 down/up 检测）
    editorDisposablesRef.current.push(_editor.onMouseDown(handleEditorMouseDown))
    editorDisposablesRef.current.push(_editor.onMouseUp(handleEditorMouseUp))
    // Focus when the editor finishes mounting while this tab is already active
    if (isActiveRef.current) {
      _editor.focus()
    }
  }, [doSave, diffLines, applyDiffDecorations, filePath, handleEditorMouseDown, handleEditorMouseUp])

  const absoluteFilePath = useAbsoluteFilePath(worktreePath, filePath, workspaceId)

  return (
    <EditorContainer filePath={absoluteFilePath} loading={loading} error={error}>
      <MonacoEditor
        height="100%"
        language={detectLanguage(filePath)}
        value={content}
        theme={monacoTheme}
        onChange={(value) => {
          setContent(value ?? '')
          scheduleDiffRefresh()
        }}
        onMount={handleEditorMount}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          lineNumbers: 'on',
          padding: { top: 8, bottom: 8 },
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />
      {peek && changes.length > 0 && editorRef.current && (
        <QuickDiffPeek
          sessionId={sessionId}
          filePath={filePath}
          changes={changes}
          currentIndex={peek.index}
          anchorLine={peek.anchorLine}
          hostEditor={editorRef.current}
          onClose={() => setPeek(null)}
          onNavigate={handlePeekNavigate}
          onRevertSuccess={handleReverted}
        />
      )}
    </EditorContainer>
  )
})
