import { useState, useEffect, lazy, Suspense, memo, useRef, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import type { DiffFile } from '@akari/shared-types'
import type { editor } from 'monaco-editor'
import { useTheme } from '@/shared/components/theme-provider'
import { detectLanguage } from '@/shared/lib/language-utils'
import { apiClient } from '@/shared/lib/api-client'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { resolveAbsoluteFilePath } from '@/shared/lib/path-utils'
import { fileUpdateBus } from '@/shared/lib/fileUpdateBus'
import { useShallow } from 'zustand/react/shallow'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.DiffEditor }))
)

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
  const { resolvedTheme } = useTheme()
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'light'

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
  const workspace = useWorkspaceStore(
    useShallow(s => s.workspaces.find(w => w.id === workspaceId) ?? null),
  )
  const absoluteFilePath = resolveAbsoluteFilePath(worktreePath, filePath, workspace)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* File path + diff stats */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="truncate text-[11px] text-muted-foreground font-mono">{absoluteFilePath}</span>
        {currentFile && (
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <span className="font-mono text-green-500">+{currentFile.additions}</span>
            <span className="font-mono text-red-400">-{currentFile.deletions}</span>
          </div>
        )}
      </div>

      {/* Monaco Diff Editor */}
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
        {content && !loading && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载编辑器...
              </div>
            }
          >
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
          </Suspense>
        )}
        {!content && !loading && !error && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            选择文件查看差异
          </div>
        )}
      </div>
    </div>
  )
})
