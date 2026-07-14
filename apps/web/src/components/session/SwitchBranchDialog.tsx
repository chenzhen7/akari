import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
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
import type { GitBranch as GitBranchType } from '@akari/shared-types'
import { apiClient } from '@/lib/api-client'

interface SwitchBranchDialogProps {
  sessionId: string
  currentBranch: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SwitchBranchDialog({ sessionId, currentBranch, open, onOpenChange }: SwitchBranchDialogProps) {
  const [branches, setBranches] = useState<GitBranchType[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    apiClient.get<GitBranchType[]>(`/sessions/${sessionId}/git-branches`, { toast: '加载分支失败' })
      .then(data => {
        setBranches(data)
        setSelected(data.find(b => b.name === currentBranch && !b.isRemote)?.name ?? '')
      })
      .catch(err => console.error('[SwitchBranchDialog] fetch branches failed:', err))
      .finally(() => setLoading(false))
  }, [open, sessionId, currentBranch])

  const localBranches = useMemo(
    () => branches.filter(b => !b.isRemote).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)),
    [branches],
  )

  const handleSubmit = async () => {
    if (!selected || selected === currentBranch) {
      onOpenChange(false)
      return
    }
    setSubmitting(true)
    const loadingId = toast.loading(`正在切换到 ${selected}...`)
    try {
      await apiClient.post(`/sessions/${sessionId}/git/checkout`, { branch: selected }, { toast: '切换分支失败' })
      toast.dismiss(loadingId)
      toast.success(`已切换到 ${selected}`)
      onOpenChange(false)
    } catch (err) {
      toast.dismiss(loadingId)
      console.error('[SwitchBranchDialog] checkout failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            切换分支
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            当前分支：{currentBranch || '—'}
          </DialogDescription>
        </DialogHeader>

        <div className="my-3">
          {loading ? (
            <div className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载分支中...
            </div>
          ) : localBranches.length === 0 ? (
            <div className="text-xs text-muted-foreground">暂无可切换分支</div>
          ) : (
            <Select value={selected} onValueChange={setSelected} disabled={submitting}>
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue placeholder="选择分支" />
              </SelectTrigger>
              <SelectContent>
                {localBranches.map(branch => (
                  <SelectItem key={branch.name} value={branch.name} className="text-xs">
                    {branch.name}
                    {branch.isCurrent && ' (当前)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSubmit}
            disabled={submitting || !selected || selected === currentBranch || loading}
          >
            {submitting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
            切换
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
