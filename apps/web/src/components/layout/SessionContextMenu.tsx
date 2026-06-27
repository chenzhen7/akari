import { useEffect, useRef } from 'react'
import { GitCommit, GitMerge, GitBranch, Copy, Check, FolderOpen } from 'lucide-react'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { API_BASE } from '@/stores/session-store'
import type { AgentSession } from '@/types'

interface SessionContextMenuProps {
  session: AgentSession
  x: number
  y: number
  onClose: () => void
  onSwitchBranch: () => void
}

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void | Promise<void>
}

function MenuItem({ icon: Icon, label, onClick }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  )
}

function MenuGroup({ label }: { label: string }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-border" />
}

async function postJson(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? `HTTP ${res.status}`)
  }
}

export function SessionContextMenu({ session, x, y, onClose, onSwitchBranch }: SessionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouse)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouse)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} 已复制`, { icon: <Check className="h-3.5 w-3.5" /> })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[copy ${label}] failed:`, err)
      toastError(`复制 ${label} 失败：${msg}`)
    }
    onClose()
  }

  const handleCopySessionId = () => {
    void copyToClipboard(session.id, 'Session ID')
  }

  const handleCopyWorktreePath = () => {
    void copyToClipboard(session.worktreePath, 'Worktree 路径')
  }

  const handleCopyBranchName = () => {
    void copyToClipboard(session.branchName, '分支名')
  }

  const canOpenFolder = typeof window !== 'undefined' && !!window.electron?.shell?.openPath

  const handleOpenFolder = async () => {
    const openPath = window.electron?.shell?.openPath
    if (!openPath) {
      onClose()
      return
    }
    try {
      const error = await openPath(session.worktreePath)
      if (error) {
        throw new Error(error)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[openFolder] failed:', err)
      toastError(`打开文件夹失败：${msg}`)
    }
    onClose()
  }

  const handleCommit = async () => {
    const message = window.prompt('输入提交信息：')
    if (!message?.trim()) {
      onClose()
      return
    }
    const loadingId = toast.loading('正在提交...')
    try {
      await postJson(`/sessions/${session.id}/git/commit`, { message: message.trim() })
      toast.dismiss(loadingId)
      toast.success('提交成功')
    } catch (err) {
      toast.dismiss(loadingId)
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[commit] failed:', err)
      toastError(`提交失败：${msg}`)
    }
    onClose()
  }

  const handleUpdateFromBase = async () => {
    const loadingId = toast.loading(`正在从 ${session.baseBranch} 更新...`)
    try {
      await postJson(`/sessions/${session.id}/git/update-branch`, {})
      toast.dismiss(loadingId)
      toast.success(`已从 ${session.baseBranch} 更新`)
    } catch (err) {
      toast.dismiss(loadingId)
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[updateFromBase] failed:', err)
      toastError(`更新失败：${msg}`)
    }
    onClose()
  }

  const handleSwitchBranch = () => {
    onSwitchBranch()
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[200px] rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {canOpenFolder && (
        <>
          <MenuGroup label="系统" />
          <MenuItem icon={FolderOpen} label="打开文件夹" onClick={handleOpenFolder} />
          <MenuDivider />
        </>
      )}

      <MenuGroup label="信息" />
      <MenuItem icon={Copy} label="复制 Session ID" onClick={handleCopySessionId} />
      <MenuItem icon={Copy} label="复制 Worktree 路径" onClick={handleCopyWorktreePath} />
      <MenuItem icon={Copy} label="复制分支名" onClick={handleCopyBranchName} />

      <MenuDivider />

      <MenuGroup label="Git" />
      <MenuItem icon={GitBranch} label="切换分支" onClick={handleSwitchBranch} />
      <MenuItem icon={GitCommit} label="提交..." onClick={handleCommit} />
      <MenuItem icon={GitMerge} label={`从 ${session.baseBranch} 更新`} onClick={handleUpdateFromBase} />
    </div>
  )
}
