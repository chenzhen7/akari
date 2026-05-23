import { useState, useEffect, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { DiffFile } from '@akari/shared-types'
import { cn } from '@/lib/utils'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.DiffEditor }))
)

interface DiffViewerProps {
  sessionId: string
  diffFiles?: DiffFile[]
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'shell', bash: 'shell',
  txt: 'plaintext', vue: 'html', svelte: 'html',
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}

function statusColor(s: DiffFile['status']) {
  return s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : s === 'R' ? 'text-blue-500' : 'text-amber-500'
}

export function DiffViewer({ sessionId, diffFiles }: DiffViewerProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffVersion, setDiffVersion] = useState(0)

  useEffect(() => {
    if (!diffFiles || diffFiles.length === 0) {
      setSelectedFile(null)
      setContent(null)
      return
    }
    setSelectedFile(prev =>
      prev && diffFiles.find(f => f.path === prev) ? prev : diffFiles[0].path
    )
    setDiffVersion(v => v + 1)
  }, [diffFiles])

  useEffect(() => {
    if (!selectedFile || !sessionId) return
    setLoading(true)
    setError(null)
    setContent(null)
    fetch(`/api/sessions/${sessionId}/diff-content?file=${encodeURIComponent(selectedFile)}`)
      .then(r => r.ok ? r.json() as Promise<{ original: string; modified: string }> : Promise.reject(r.statusText))
      .then(data => setContent(data))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selectedFile, sessionId, diffVersion])

  if (!diffFiles || diffFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无变更
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* File list */}
      <div className="w-48 shrink-0 overflow-y-auto border-r border-border bg-muted/20 py-1">
        {diffFiles.map(f => (
          <button
            key={f.path}
            onClick={() => setSelectedFile(f.path)}
            className={cn(
              'flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-muted/60 transition-colors',
              selectedFile === f.path && 'bg-muted/80',
            )}
          >
            <span className={cn('mt-px shrink-0 text-[10px] font-bold leading-4', statusColor(f.status))}>
              {f.status}
            </span>
            <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-tight text-muted-foreground">
              {f.path}
            </span>
          </button>
        ))}
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
              language={detectLanguage(selectedFile ?? '')}
              original={content.original}
              modified={content.modified}
              theme="vs-dark"
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
            选择左侧文件查看差异
          </div>
        )}
      </div>
    </div>
  )
}
