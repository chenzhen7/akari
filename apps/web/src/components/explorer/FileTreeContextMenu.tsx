import { useEffect, useRef, useCallback } from 'react'
import { FolderOpen, Copy, Check, Terminal } from 'lucide-react'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/session-store'
import { useConnectionStore } from '@/stores/connection-store'
import type { FileNode } from '@akari/shared-types'

interface FileTreeContextMenuProps {
  sessionId: string
  terminalId: string
  worktreePath: string
  node: FileNode
  x: number
  y: number
  onClose: () => void
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

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function getFullPath(worktreePath: string, relativePath: string): string {
  const base = normalizePath(worktreePath).replace(/\/$/, '')
  const rel = normalizePath(relativePath).replace(/^\//, '')
  return rel ? `${base}/${rel}` : base
}

function getFolderPath(fullPath: string, type: FileNode['type']): string {
  if (type === 'directory') return fullPath
  const lastSlash = fullPath.lastIndexOf('/')
  return lastSlash > 0 ? fullPath.slice(0, lastSlash) : fullPath
}

export function FileTreeContextMenu({
  sessionId,
  terminalId,
  worktreePath,
  node,
  x,
  y,
  onClose,
}: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const sendTerminalInput = useConnectionStore(s => s.sendTerminalInput)
  const activeTab = useSessionStore(
    useCallback(
      (s) => {
        const session = s.sessions.find(sess => sess.id === sessionId)
        if (!session) return null
        return session.tabs.find(t => t.id === session.activeTabId) ?? null
      },
      [sessionId],
    ),
  )

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

  const fullPath = getFullPath(worktreePath, node.path)
  const folderPath = getFolderPath(fullPath, node.type)
  const relativePath = node.path || '.'

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

  const handleOpenFolder = async () => {
    const openPath = window.electron?.shell?.openPath
    if (!openPath) {
      onClose()
      return
    }
    try {
      const error = await openPath(folderPath)
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

  const handleCopyPath = () => {
    void copyToClipboard(relativePath, '文件路径')
  }

  const handleSendToTerminal = () => {
    const activeTabType = activeTab?.type
    if (activeTabType !== 'terminal' && activeTabType !== 'agent') {
      onClose()
      return
    }
    const targetTerminalId = activeTabType === 'terminal' && activeTab?.terminalId
      ? activeTab.terminalId
      : terminalId
    const sent = sendTerminalInput(sessionId, targetTerminalId, `"${relativePath}" `)
    if (sent) {
      toast.success('已添加到终端')
    } else {
      toastError('终端未连接，无法添加路径')
    }
    onClose()
  }

  const canOpenFolder = typeof window !== 'undefined' && !!window.electron?.shell?.openPath

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {canOpenFolder && (
        <MenuItem icon={FolderOpen} label="打开文件夹" onClick={handleOpenFolder} />
      )}
      <MenuItem icon={Copy} label="复制路径" onClick={handleCopyPath} />
      <MenuItem icon={Terminal} label="添加路径到终端" onClick={handleSendToTerminal} />
    </div>
  )
}
