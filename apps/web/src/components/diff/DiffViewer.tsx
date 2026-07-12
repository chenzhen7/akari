import { useState, useEffect, lazy, Suspense, memo } from 'react'
import { Loader2 } from 'lucide-react'
import { toastError } from '@/lib/toast'
import type { DiffFile } from '@akari/shared-types'
import { useTheme } from '@/components/theme-provider'
import { detectLanguage } from '@/lib/language-utils'
import { API_BASE } from '@/lib/api'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { resolveAbsoluteFilePath } from '@/lib/path-utils'
import { fileUpdateBus } from '@/lib/fileUpdateBus'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.DiffEditor }))
)

interface DiffViewerProps {
  sessionId: string
  filePath: string
  diffFiles: DiffFile[]
  workspaceId: string
  worktreePath: string
}

export const DiffViewer = memo(function DiffViewer({ sessionId, filePath, diffFiles, workspaceId, worktreePath }: DiffViewerProps) {
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { resolvedTheme } = useTheme()
  const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'light'

  useEffect(() => {
    if (!filePath || !sessionId) return
    setLoading(true)
    setError(null)
    setContent(null)
    fetch(`${API_BASE}/sessions/${sessionId}/diff-content?file=${encodeURIComponent(filePath)}`)
      .then(r => r.ok ? r.json() as Promise<{ original: string; modified: string }> : Promise.reject(r.statusText))
      .then(data => setContent(data))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [filePath, sessionId])

  // Listen for external file changes broadcast from the shared watcher
  useEffect(() => {
    return fileUpdateBus.on(sessionId, (event) => {
      if (event.filePath !== filePath) return
      setLoading(true)
      setError(null)
      setContent(null)
      fetch(`${API_BASE}/sessions/${sessionId}/diff-content?file=${encodeURIComponent(filePath)}`)
        .then(r => r.ok ? r.json() as Promise<{ original: string; modified: string }> : Promise.reject(r.statusText))
        .then(data => setContent(data))
        .catch((e: unknown) => toastError(`重新加载 diff 失败: ${String(e)}`))
        .finally(() => setLoading(false))
    })
  }, [sessionId, filePath])

  const currentFile = diffFiles.find(f => f.path === filePath)
  const workspace = useWorkspaceStore(s => s.workspaces.find(w => w.id === workspaceId) ?? null)
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
