import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, FolderOpen } from 'lucide-react'
import { FileBrowserDialog } from '@/components/workspace/FileBrowserDialog'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [worktreeBaseDir, setWorktreeBaseDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/settings')
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setWorktreeBaseDir(data.worktreeBaseDir ?? '')
      })
      .catch(err => {
        console.error('[SettingsDialog] load failed:', err)
        toast.error(`加载设置失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoading(false))
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktreeBaseDir: worktreeBaseDir.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('设置已保存')
      onOpenChange(false)
    } catch (err) {
      console.error('[SettingsDialog] save failed:', err)
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>配置 Akari 的工作目录与其他选项。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="worktree-dir">工作树目录</Label>
              <div className="flex gap-2">
                <Input
                  id="worktree-dir"
                  value={worktreeBaseDir}
                  onChange={e => setWorktreeBaseDir(e.target.value)}
                  placeholder="留空使用默认值"
                  disabled={loading}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  onClick={() => setBrowserOpen(true)}
                  disabled={loading}
                  title="浏览..."
                >
                  <FolderOpen className="h-4 w-4 " />
                  浏览
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Agent 会话的独立工作区将创建在此目录下。修改后仅对新会话生效。
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={loading || saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FileBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={(path) => setWorktreeBaseDir(path)}
      />
    </>
  )
}
