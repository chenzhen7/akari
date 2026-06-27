import { useEffect, useState, useCallback } from 'react'
import { toast, toastError } from '@/lib/toast'
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
import { Loader2, FolderOpen, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'
import { API_BASE } from '@/lib/api'
import { selectFolder } from '@/lib/native-file-picker'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const [worktreeBaseDir, setWorktreeBaseDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`${API_BASE}/settings`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setWorktreeBaseDir(data.worktreeBaseDir ?? '')
      })
      .catch(err => {
        console.error('[SettingsDialog] load failed:', err)
        toastError(`加载设置失败：${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoading(false))
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/settings`, {
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
      toastError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleBrowse = useCallback(async () => {
    try {
      const path = await selectFolder(worktreeBaseDir || undefined)
      if (path) {
        setWorktreeBaseDir(path)
      }
    } catch (err) {
      toastError(`选择目录失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [worktreeBaseDir])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>配置 Akari 的工作目录与其他选项。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>外观</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setTheme('light')}
              >
                <Sun className="mr-2 h-4 w-4" />
                浅色
              </Button>
              <Button
                type="button"
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setTheme('dark')}
              >
                <Moon className="mr-2 h-4 w-4" />
                深色
              </Button>
            </div>
          </div>

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
                onClick={handleBrowse}
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
  )
}
