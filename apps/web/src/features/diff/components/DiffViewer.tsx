import { useState, useEffect, memo, useRef, useCallback } from 'react'
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react'
import type { DiffFile } from '@akari/shared-types'
import type { editor } from 'monaco-editor'
import { detectLanguage } from '@/shared/lib/language-utils'
import { apiClient } from '@/shared/lib/api-client'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'
import { useMonacoTheme } from '@/shared/hooks/useMonacoTheme'
import { useAbsoluteFilePath } from '@/shared/hooks/useAbsoluteFilePath'
import { EditorContainer } from '@/shared/components/EditorContainer'

interface DiffViewerProps {
  sessionId: string
  filePath: string
  diffFiles: DiffFile[]
  workspaceId: string
  worktreePath: string
  isActive?: boolean
}

export const DiffViewer = memo(function DiffViewer({ sessionId, filePath, diffFiles, workspaceId, worktreePath, isActive }: DiffViewerProps) {
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const monacoTheme = useMonacoTheme()

  useEffect(() => {
    if (!filePath || !sessionId) return
    setLoading(true)
    setError(null)
    setContent(null)

    const controller = new AbortController()
    apiClient.get<{ original: string; modified: string }>(`/sessions/${sessionId}/diff-content`, {
      params: { file: filePath },
      signal: controller.signal,
      toast: false,
    })
      .then(data => setContent(data))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setError(String(e))
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [filePath, sessionId])

  // Listen for external file changes broadcast from the shared watcher
  useEffect(() => {
    return fileUpdateBus.on(sessionId, (event) => {
      if (event.filePath !== filePath) return
      setLoading(true)
      setError(null)
      setContent(null)
      apiClient.get<{ original: string; modified: string }>(`/sessions/${sessionId}/diff-content`, {
        params: { file: filePath },
        toast: '重新加载 diff 失败',
      })
        .then(data => setContent(data))
        .catch((e: unknown) => console.error('[DiffViewer] reload failed:', e))
        .finally(() => setLoading(false))
    })
  }, [sessionId, filePath])

  // Relayout the diff editor when this tab becomes active again.
  useEffect(() => {
    if (!isActive) return
    const editor = diffEditorRef.current
    if (!editor) return
    try {
      editor.layout()
    } catch { /* ignore */ }
  }, [isActive])

  const handleEditorMount = useCallback((editor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor
  }, [])

  const currentFile = diffFiles.find(f => f.path === filePath)
  const absoluteFilePath = useAbsoluteFilePath(worktreePath, filePath, workspaceId)

  const diffStats = currentFile ? (
    <div className="ml-auto flex items-center gap-2 text-[11px]">
      <span className="font-mono text-green-500">+{currentFile.additions}</span>
      <span className="font-mono text-red-400">-{currentFile.deletions}</span>
    </div>
  ) : null

  return (
    <EditorContainer filePath={absoluteFilePath} loading={loading} error={error} headerExtra={diffStats}>
      {content && (
        <MonacoDiffEditor
          height="100%"
          language={detectLanguage(filePath)}
          original={content.original}
          modified={content.modified}
          theme={monacoTheme}
          onMount={handleEditorMount}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            lineNumbers: 'on',
            padding: { top: 8, bottom: 8 },
            diffWordWrap: 'off',
          }}
        />
      )}
      {!content && !error && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          选择文件查看差异
        </div>
      )}
    </EditorContainer>
  )
})
