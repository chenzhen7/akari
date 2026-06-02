import { useState, useEffect, lazy, Suspense } from 'react'
import { Loader2, ArrowLeft } from 'lucide-react'
import type { AgentSession } from '@akari/shared-types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.DiffEditor }))
)

interface DiffViewerProps {
  session: AgentSession
  filePath: string
  onBack: () => void
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

export function DiffViewer({ session, filePath, onBack }: DiffViewerProps) {
  const sessionId = session.id
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!filePath || !sessionId) return
    setLoading(true)
    setError(null)
    setContent(null)
    fetch(`/api/sessions/${sessionId}/diff-content?file=${encodeURIComponent(filePath)}`)
      .then(r => r.ok ? r.json() as Promise<{ original: string; modified: string }> : Promise.reject(r.statusText))
      .then(data => setContent(data))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [filePath, sessionId])

  const diffFiles = session.diffFiles ?? []
  const currentFile = diffFiles.find(f => f.path === filePath)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* Toolbar with back button */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">返回文件列表</TooltipContent>
        </Tooltip>

        <span className="truncate text-[11px] text-muted-foreground font-mono ml-2">{filePath}</span>
      </div>

      {/* File diff stats */}
      {currentFile && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1 text-[11px]">
          <span className="font-mono text-green-500">+{currentFile.additions}</span>
          <span className="font-mono text-red-400">-{currentFile.deletions}</span>
        </div>
      )}

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
            选择文件查看差异
          </div>
        )}
      </div>
    </div>
  )
}
