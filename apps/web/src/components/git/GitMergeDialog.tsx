import { useState, useEffect } from 'react'
import { toast } from '@/lib/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GitBranch } from '@akari/shared-types'
import { apiClient } from '@/lib/api-client'

interface GitMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  currentBranch: string
}

export function GitMergeDialog({ open, onOpenChange, sessionId, currentBranch }: GitMergeDialogProps) {
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [sourceBranch, setSourceBranch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    apiClient.get<GitBranch[]>(`/sessions/${sessionId}/git-branches`, { toast: false })
      .then((data) => {
        const candidates = data.filter(b => !b.isRemote && b.name !== currentBranch)
        setBranches(candidates)
        if (candidates[0]) setSourceBranch(candidates[0].name)
      })
      .catch(err => console.error('[GitMergeDialog] fetch branches failed:', err))
  }, [open, sessionId, currentBranch])

  const handleMerge = async () => {
    if (!sourceBranch) {
      toast.error('请选择要合并的分支')
      return
    }
    setLoading(true)
    try {
      await apiClient.post(`/sessions/${sessionId}/git/merge`, { sourceBranch }, { toast: '合并失败' })
      toast.success(`已将 ${sourceBranch} 合并到 ${currentBranch}`)
      onOpenChange(false)
    } catch (err) {
      console.error('[GitMergeDialog] merge failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>合并分支</DialogTitle>
          <DialogDescription className="break-words">
            将所选分支合并到当前分支{' '}
            <span className="break-all font-mono text-foreground">{currentBranch}</span>（--no-ff）
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-medium">要合并的分支</p>
            {branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">没有可合并的本地分支</p>
            ) : (
              <Select value={sourceBranch} onValueChange={setSourceBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="选择分支" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(b => (
                    <SelectItem key={b.name} value={b.name}>
                      <span className="break-all font-mono text-sm">{b.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button
            onClick={() => void handleMerge()}
            disabled={loading || !sourceBranch || branches.length === 0}
          >
            {loading ? '合并中...' : '确认合并'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
