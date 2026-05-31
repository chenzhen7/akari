import { useState, useEffect, lazy, Suspense } from 'react'
import { Loader2, GitCommit, Trash2, GitMerge, GitBranch, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentSession } from '@akari/shared-types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

const MonacoDiffEditor = lazy(() =>
  import('@monaco-editor/react').then(m => ({ default: m.DiffEditor }))
)

interface DiffViewerProps {
  session: AgentSession
  filePath: string
  onBack: () => void
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

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

  // Commit dialog
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  // Discard dialog
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  // Merge dialog
  const [mergeOpen, setMergeOpen] = useState(false)
  const [merging, setMerging] = useState(false)

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

  async function handleCommit() {
    if (!commitMsg.trim()) return
    setCommitting(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg.trim() }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success('已提交')
      setCommitMsg('')
      setCommitOpen(false)
    } catch (e) {
      toast.error(`提交失败: ${String(e)}`)
    } finally {
      setCommitting(false)
    }
  }

  async function handleDiscard() {
    setDiscarding(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/git/discard`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success('已丢弃所有变更')
      setDiscardOpen(false)
    } catch (e) {
      toast.error(`丢弃失败: ${String(e)}`)
    } finally {
      setDiscarding(false)
    }
  }

  async function handleMerge() {
    setMerging(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/git/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBranch: session.branchName }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success(`已合并 ${session.branchName} → ${session.baseBranch}`)
      setMergeOpen(false)
    } catch (e) {
      toast.error(`合并失败: ${String(e)}`)
    } finally {
      setMerging(false)
    }
  }

  const diffFiles = session.diffFiles ?? []
  const hasDiff = diffFiles.length > 0
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

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="font-mono">{session.branchName}</span>
          <span className="opacity-50">→</span>
          <span className="font-mono">{session.baseBranch}</span>
        </div>

        <span className="truncate text-[11px] text-muted-foreground font-mono ml-2">{filePath}</span>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={!hasDiff}
                onClick={() => setCommitOpen(true)}
              >
                <GitCommit className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Commit 所有变更</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                disabled={!hasDiff}
                onClick={() => setMergeOpen(true)}
              >
                <GitMerge className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">合并到基准分支</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-red-400 hover:text-red-400"
                disabled={!hasDiff}
                onClick={() => setDiscardOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">丢弃所有变更</TooltipContent>
          </Tooltip>
        </div>
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

      {/* Commit dialog */}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>提交所有变更</DialogTitle>
            <DialogDescription>
              将暂存全部文件（git add -A）并创建新提交。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="提交信息（必填）"
            className="min-h-[80px] resize-none"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleCommit()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitOpen(false)} disabled={committing}>取消</Button>
            <Button onClick={() => void handleCommit()} disabled={!commitMsg.trim() || committing}>
              {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '提交'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard dialog */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>丢弃所有变更</DialogTitle>
            <DialogDescription>
              将执行 <span className="font-mono text-foreground">git checkout -- .</span> 和{' '}
              <span className="font-mono text-foreground">git clean -fd</span>，
              撤销所有未提交的修改并删除未跟踪文件。此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)} disabled={discarding}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDiscard()} disabled={discarding}>
              {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认丢弃'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>合并到基准分支</DialogTitle>
            <DialogDescription>
              将把{' '}
              <span className="font-mono text-foreground">{session.branchName}</span>{' '}
              合并（--no-ff）到{' '}
              <span className="font-mono text-foreground">{session.baseBranch}</span>。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={merging}>取消</Button>
            <Button onClick={() => void handleMerge()} disabled={merging}>
              {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认合并'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
