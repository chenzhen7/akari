import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { DiffFile } from '@akari/shared-types'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface GitCommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  diffFiles: DiffFile[]
}

export function GitCommitDialog({ open, onOpenChange, sessionId, diffFiles }: GitCommitDialogProps) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCommit = async () => {
    if (!message.trim()) {
      toast.error('请填写 commit message')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${sessionId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? res.statusText)
      }
      toast.success('Commit 成功')
      setMessage('')
      onOpenChange(false)
    } catch (err) {
      toast.error(`Commit 失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>提交变更</DialogTitle>
          <DialogDescription>
            将暂存所有变更文件（git add -A）并创建 commit
          </DialogDescription>
        </DialogHeader>

        {diffFiles.length > 0 && (
          <div className="max-h-40 overflow-auto rounded-md border border-border bg-muted/30 p-2 space-y-0.5 text-xs font-mono">
            {diffFiles.map(f => (
              <div key={f.path} className="flex items-center gap-1.5">
                <span
                  className={
                    f.status === 'A' ? 'text-green-500' :
                    f.status === 'D' ? 'text-red-500' :
                    f.status === 'R' ? 'text-blue-500' :
                    'text-amber-500'
                  }
                >
                  {f.status}
                </span>
                <span className="truncate text-foreground">{f.path}</span>
                <span className="ml-auto shrink-0 text-green-500">+{f.additions}</span>
                <span className="shrink-0 text-red-400">-{f.deletions}</span>
              </div>
            ))}
          </div>
        )}

        {diffFiles.length === 0 && (
          <p className="text-sm text-muted-foreground">
            暂无已跟踪的变更。将使用 <code className="text-xs">git add -A</code> 暂存所有新文件。
          </p>
        )}

        <Textarea
          placeholder="Commit message（必填）"
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="min-h-[80px] resize-none font-mono text-sm"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleCommit()
            }
          }}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={() => void handleCommit()} disabled={loading || !message.trim()}>
            {loading ? '提交中...' : '提交'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
