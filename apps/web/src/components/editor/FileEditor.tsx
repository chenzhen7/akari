import { useState, useEffect, lazy, Suspense, useCallback, useRef, memo } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import type { FileDiffLine } from '@akari/shared-types'
import type { editor } from 'monaco-editor'
import { apiClient } from '@/lib/api-client'
import { useTheme } from '@/components/theme-provider'
import { detectLanguage } from '@/lib/language-utils'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { resolveAbsoluteFilePath } from '@/lib/path-utils'
import { fileUpdateBus } from '@/lib/fileUpdateBus'
import { useShallow } from 'zustand/react/shallow'

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.Editor }))
)

const AUTO_SAVE_DELAY = 800

interface FileEditorProps {
  sessionId: string
  workspaceId: string
  worktreePath: string
  filePath: string
}

export const FileEditor = memo(function FileEditor({ sessionId, workspaceId, worktreePath, filePath }: FileEditorProps) {
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
  contentRef.current = content
  isDirtyRef.current = isDirty
  const { resolvedTheme } = useTheme()
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'light'

  // Fetch diff lines helper
  const fetchDiffLines = useCallback(async () => {
    if (!filePath || !sessionId) return
    try {
      const data = await apiClient.get<{ lines: FileDiffLine[] }>(`/sessions/${sessionId}/diff-lines`, {
        params: { path: filePath },
        toast: false,
      })
      setDiffLines(data.lines)
    } catch (err) {
      console.error('[FileEditor] fetch diff lines failed:', err)
    }
  }, [filePath, sessionId])

  // Apply decorations to Monaco editor
  const applyDiffDecorations = useCallback((editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor'), lines: FileDiffLine[]) => {
    decorationsRef.current?.clear()

    const decorationOptions = lines.map(line => {
      const className =
        line.type === 'added' ? 'margin-line-added'
        : line.type === 'modified' ? 'margin-line-modified'
        : 'margin-line-removed'
      return {
        range: new monaco.Range(line.lineNumber, 1, line.lineNumber, 1),
        options: {
          isWholeLine: true,
          marginClassName: className,
          overviewRuler: {
            color: line.type === 'added' ? 'rgba(46,160,67,0.8)'
              : line.type === 'modified' ? 'rgba(47,129,247,0.8)'
              : 'rgba(248,81,73,0.8)',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      }
    })

    decorationsRef.current = editor.createDecorationsCollection(decorationOptions)
  }, [])

  useEffect(() => {
    if (!filePath || !sessionId) return
    setLoading(true)
    setError(null)
    setContent('')
    setOriginalContent('')
    setDiffLines(null)
    decorationsRef.current?.clear()

    const controller = new AbortController()
    apiClient.get<{ content: string }>(`/sessions/${sessionId}/file-content`, {
      params: { path: filePath },
      signal: controller.signal,
      toast: false,
    })
      .then(data => {
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

  // Apply diff decorations when diffLines changes and editor is ready
  useEffect(() => {
    if (editorRef.current && monacoRef.current && diffLines && diffLines.length > 0) {
      applyDiffDecorations(editorRef.current, monacoRef.current, diffLines)
    }
  }, [diffLines, applyDiffDecorations])

  // Cleanup on unmount or filePath change
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
        autoSaveTimer.current = null
      }
      decorationsRef.current?.clear()
      editorRef.current = null
      monacoRef.current = null
    }
  }, [])

  // Listen for external file changes broadcast from the shared watcher
  useEffect(() => {
    return fileUpdateBus.on(sessionId, (event) => {
      if (event.filePath !== filePath) return

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
    })
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

  const handleEditorMount = useCallback((_editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = _editor
    monacoRef.current = monaco
    _editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        doSave()
      }
    )
    // Apply initial diff decorations if already loaded
    if (diffLines && diffLines.length > 0) {
      applyDiffDecorations(_editor, monaco, diffLines)
    }
  }, [doSave, diffLines, applyDiffDecorations])

  const workspace = useWorkspaceStore(
    useShallow(s => s.workspaces.find(w => w.id === workspaceId) ?? null),
  )
  const absoluteFilePath = resolveAbsoluteFilePath(worktreePath, filePath, workspace)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 bg-muted/30 px-3 py-1.5">
        <span className="truncate text-[11px] text-muted-foreground font-mono">{absoluteFilePath}</span>
      </div>

      {/* Monaco Editor */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载文件内容...
          </div>
        )}
        {error && !loading && (
          <div className="flex h-full items-center justify-center p-4 text-sm text-red-400">
            加载失败: {error}
          </div>
        )}
        {!loading && !error && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载编辑器...
              </div>
            }
          >
            <MonacoEditor
              height="100%"
              language={detectLanguage(filePath)}
              value={content}
              theme={monacoTheme}
              onChange={(value) => setContent(value ?? '')}
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
          </Suspense>
        )}
      </div>
    </div>
  )
})
