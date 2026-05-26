import { useState, useEffect, lazy, Suspense } from 'react'
import { Loader2, GitCommit, Trash2, GitMerge, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentSession } from '@akari/shared-types'
import { cn } from '@/lib/utils'
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

function statusColor(s: 'A' | 'M' | 'D' | 'R') {
  return s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : s === 'R' ? 'text-blue-400' : 'text-amber-400'
}

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.replace(/\\/g, '/').split('/')
  const name = parts.pop() ?? filePath
  const dir = parts.join('/')
  return { dir, name }
}

export function DiffViewer({ session }: DiffViewerProps) {
  const sessionId = session.id
  const diffFiles = session.diffFiles

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffVersion, setDiffVersion] = useState(0)

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

  const hasDiff = diffFiles && diffFiles.length > 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Git actions toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        {/* LEFT: branch info */}
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="font-mono">{session.branchName}</span>
          <span className="opacity-50">→</span>
          <span className="font-mono">{session.baseBranch}</span>
        </div>

        {/* RIGHT: icon-only action buttons */}
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

      {/* Main content */}
      {!hasDiff ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          暂无变更
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* File list — VSCode style */}
          <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border">
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-2 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">变更文件</span>
              <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">{diffFiles.length}</span>
              <div className="ml-auto flex items-center gap-0.5 font-mono text-[10px]">
                {diffFiles.reduce((s, f) => s + f.additions, 0) > 0 && (
                  <span className="text-green-500">+{diffFiles.reduce((s, f) => s + f.additions, 0)}</span>
                )}
                {diffFiles.reduce((s, f) => s + f.deletions, 0) > 0 && (
                  <span className="text-red-400">-{diffFiles.reduce((s, f) => s + f.deletions, 0)}</span>
                )}
              </div>
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
      )}

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
