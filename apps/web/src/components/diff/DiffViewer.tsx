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
  return s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : s === 'R' ? 'text-blue-400' : 'text-amber-400'
}

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.replace(/\\/g, '/').split('/')
  const name = parts.pop() ?? filePath
  const dir = parts.join('/')
  return { dir, name }
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
      {/* File list — VSCode style */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="flex shrink-0 items-center border-b border-border/50 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">变更文件</span>
          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">{diffFiles.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto py-0.5">
          {diffFiles.map(f => {
            const { dir, name } = splitPath(f.path)
            const isSelected = selectedFile === f.path
            const hasAdd = f.additions > 0
            const hasDel = f.deletions > 0
            return (
              <button
                key={f.path}
                onClick={() => setSelectedFile(f.path)}
                className={cn(
                  'flex w-full items-center gap-1.5 py-1 pl-1.5 pr-2 text-left transition-colors',
                  isSelected
                    ? 'border-l-2 border-primary bg-accent/40'
                    : 'border-l-2 border-transparent hover:bg-muted/50',
                )}
              >
                <span className={cn('w-3.5 shrink-0 text-center text-[10px] font-bold leading-none', statusColor(f.status))}>
                  {f.status}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] leading-tight text-foreground">{name}</div>
                  {dir && (
                    <div className="truncate text-[10px] leading-none text-muted-foreground/70 mt-0.5">{dir}</div>
                  )}
                </div>
                {(hasAdd || hasDel) && (
                  <div className="shrink-0 font-mono text-[10px] leading-none">
                    {hasAdd && <span className="text-green-500">+{f.additions}</span>}
                    {hasAdd && hasDel && <span className="text-muted-foreground/50"> </span>}
                    {hasDel && <span className="text-red-400">-{f.deletions}</span>}
                  </div>
                )}
              </button>
            )
          })}
        </div>

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
