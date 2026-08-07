import { useState, useCallback, type FormEvent } from 'react'
import type { FileNode } from '@akari/shared-types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { apiClient } from '@/shared/lib/api-client'
import { toast } from '@/shared/lib/toast'
import { basenameRelPath, dirnameRelPath, joinRelPath } from '@/features/explorer/lib/path-utils'

export type FileMutation =
  | { type: 'create-file'; parentPath: string }
  | { type: 'create-folder'; parentPath: string }
  | { type: 'rename'; node: FileNode }
  | { type: 'delete'; node: FileNode }

interface FileMutationDialogProps {
  sessionId: string
  mutation: FileMutation
  onClose: () => void
  /** 后端操作成功后回调：ExplorerPanel 统一刷新 + 维护选中态 */
  onCommitted: (result: { action: FileMutation['type']; path: string }) => Promise<void>
}

function validateName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return '名称不能为空'
  if (trimmed.includes('/') || trimmed.includes('\\')) return '名称不能包含 / 或 \\'
  if (trimmed === '.' || trimmed === '..') return '名称不能为 . 或 ..'
  return null
}

const TITLES: Record<FileMutation['type'], string> = {
  'create-file': '新建文件',
  'create-folder': '新建文件夹',
  rename: '重命名',
  delete: '删除确认',
}

export function FileMutationDialog({ sessionId, mutation, onClose, onCommitted }: FileMutationDialogProps) {
  const [name, setName] = useState(() =>
    mutation.type === 'rename' ? basenameRelPath(mutation.node.path) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const description = useCallback((): string => {
    switch (mutation.type) {
      case 'create-file':
        return `在「${mutation.parentPath || '根目录'}」下新建文件`
      case 'create-folder':
        return `在「${mutation.parentPath || '根目录'}」下新建文件夹`
      case 'rename':
        return `将「${mutation.node.path}」重命名为：`
      case 'delete':
        return `确定删除「${mutation.node.path}」？该操作不可撤销。${
          mutation.node.type === 'directory' ? '目录将连同其中所有内容一起删除。' : ''
        }`
    }
  }, [mutation])

  const run = useCallback(
    async (action: FileMutation['type'], targetPath: string, callApi: () => Promise<unknown>) => {
      setSubmitting(true)
      setError(null)
      try {
        await callApi()
        await onCommitted({ action, path: targetPath })
        const msg =
          action === 'delete'
            ? '已删除'
            : action === 'rename'
              ? '已重命名'
              : action === 'create-file'
                ? '已新建文件'
                : '已新建文件夹'
        toast.success(msg)
        onClose()
      } catch (err) {
        // apiClient 已按前缀 toast（新建文件失败/…），这里只记日志并保持对话框打开
        console.error(`[FileMutationDialog] ${action} failed:`, err)
      } finally {
        setSubmitting(false)
      }
    },
    [onCommitted, onClose],
  )

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault()

      if (mutation.type === 'delete') {
        await run('delete', mutation.node.path, () =>
          apiClient.post(`/sessions/${sessionId}/delete`, { path: mutation.node.path }, { toast: '删除失败' }),
        )
        return
      }

      const validationError = validateName(name)
      if (validationError) {
        setError(validationError)
        return
      }
      const trimmed = name.trim()

      if (mutation.type === 'rename') {
        const from = mutation.node.path
        const to = joinRelPath(dirnameRelPath(from), trimmed)
        if (to === from) {
          onClose() // 名称未变化，直接关闭
          return
        }
        await run('rename', to, () =>
          apiClient.post(`/sessions/${sessionId}/rename`, { from, to }, { toast: '重命名失败' }),
        )
        return
      }

      const action = mutation.type // 'create-file' | 'create-folder'
      const target = joinRelPath(mutation.parentPath, trimmed)
      await run(action, target, () =>
        apiClient.post(
          `/sessions/${sessionId}/${action === 'create-file' ? 'file' : 'directory'}`,
          { path: target },
          { toast: action === 'create-file' ? '新建文件失败' : '新建文件夹失败' },
        ),
      )
    },
    [mutation, name, sessionId, run, onClose],
  )

  const isDelete = mutation.type === 'delete'

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{TITLES[mutation.type]}</DialogTitle>
          <DialogDescription>{description()}</DialogDescription>
        </DialogHeader>

        {isDelete ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={handleSubmit} disabled={submitting}>
              {submitting ? '处理中…' : '删除'}
            </Button>
          </DialogFooter>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              autoFocus
              value={name}
              onChange={e => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              placeholder={
                mutation.type === 'create-file'
                  ? '文件名（如 README.md）'
                  : mutation.type === 'create-folder'
                    ? '文件夹名'
                    : '新名称'
              }
              aria-invalid={!!error}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                取消
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? '处理中…' : '确定'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
