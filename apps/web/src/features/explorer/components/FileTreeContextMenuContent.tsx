import { useCallback } from 'react'
import { FolderOpen, Copy, Check, Terminal, FilePlus, FolderPlus, Pencil, Trash2, Scissors, ClipboardPaste } from 'lucide-react'
import { toast, toastError } from '@/shared/lib/toast'
import { findSession } from '@/features/session/stores/session-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { useConnectionStore } from '@/features/terminal/stores/connection-store'
import { dirnameRelPath } from '@/features/explorer/lib/path-utils'
import { useClipboardStore } from '@/features/explorer/stores/clipboard-store'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/shared/components/ui/context-menu'
import type { FileNode } from '@akari/shared-types'
import type { FileMutation } from './FileMutationDialog'

export type ClipboardAction = 'copy' | 'cut' | 'paste'

interface FileTreeContextMenuContentProps {
  sessionId: string
  terminalId: string
  worktreePath: string
  node: FileNode | null
  onMutation?: (m: FileMutation) => void
  onClipboardAction?: (action: ClipboardAction, node?: FileNode) => void
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

export function FileTreeContextMenuContent({
  sessionId,
  terminalId,
  worktreePath,
  node,
  onMutation,
  onClipboardAction,
}: FileTreeContextMenuContentProps) {
  const sendTerminalInput = useConnectionStore(s => s.sendTerminalInput)
  const clipActive = useClipboardStore(
    s => s.mode !== null && s.sessionId === sessionId && s.items.length > 0,
  )
  const activeTab = useWorkspaceStore(
    useCallback(
      (s) => {
        const session = findSession(s.workspaceSessions, sessionId)
        if (!session) return null
        return session.tabs.find(t => t.id === session.activeTabId) ?? null
      },
      [sessionId],
    ),
  )

  // 菜单仅在右键触发后打开，此时 node 必非空；null 时渲染空内容占位
  if (!node) return <ContextMenuContent className="min-w-45" />

  const fullPath = getFullPath(worktreePath, node.path)
  const folderPath = getFolderPath(fullPath, node.type)
  const relativePath = node.path || '.'
  const isRoot = node.path === ''
  const parentPath = node.type === 'directory' ? node.path : dirnameRelPath(node.path)

  const handleNewFile = () => onMutation?.({ type: 'create-file', parentPath })
  const handleNewFolder = () => onMutation?.({ type: 'create-folder', parentPath })
  const handleRename = () => onMutation?.({ type: 'rename', node })
  const handleDelete = () => onMutation?.({ type: 'delete', node })

  const handleCopy = () => onClipboardAction?.('copy', node)
  const handleCut = () => onClipboardAction?.('cut', node)
  const handlePaste = () => onClipboardAction?.('paste', node)

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} 已复制`, { icon: <Check className="size-3.5" /> })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[copy ${label}] failed:`, err)
      toastError(`复制 ${label} 失败：${msg}`)
    }
  }

  const handleOpenFolder = async () => {
    const openPath = window.electron?.shell?.openPath
    if (!openPath) return
    try {
      const error = await openPath(folderPath)
      if (error) throw new Error(error)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[openFolder] failed:', err)
      toastError(`打开文件夹失败：${msg}`)
    }
  }

  const handleCopyPath = () => {
    void copyToClipboard(relativePath, '文件路径')
  }

  const handleSendToTerminal = () => {
    const activeTabType = activeTab?.type
    if (activeTabType !== 'terminal' && activeTabType !== 'agent') return
    const targetTerminalId = activeTabType === 'terminal' && activeTab?.terminalId
      ? activeTab.terminalId
      : terminalId
    const sent = sendTerminalInput(sessionId, targetTerminalId, `"${relativePath}" `)
    if (sent) {
      toast.success('已添加到终端')
    } else {
      toastError('终端未连接，无法添加路径')
    }
  }

  const canOpenFolder = typeof window !== 'undefined' && !!window.electron?.shell?.openPath

  return (
    <ContextMenuContent className="min-w-45">
      <ContextMenuItem onSelect={handleNewFile}>
        <FilePlus className="size-3.5" />
        新建文件
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleNewFolder}>
        <FolderPlus className="size-3.5" />
        新建文件夹
      </ContextMenuItem>
      {!isRoot && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleCut}>
            <Scissors className="size-3.5" />
            剪切
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy}>
            <Copy className="size-3.5" />
            复制
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem onSelect={handlePaste} disabled={!clipActive}>
        <ClipboardPaste className="size-3.5" />
        粘贴
      </ContextMenuItem>
      {!isRoot && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRename}>
            <Pencil className="size-3.5" />
            重命名
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={handleDelete}>
            <Trash2 className="size-3.5" />
            删除
          </ContextMenuItem>
        </>
      )}
      {canOpenFolder && (
        <ContextMenuItem onSelect={handleOpenFolder}>
          <FolderOpen className="size-3.5" />
          打开文件夹
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleCopyPath}>
        <Copy className="size-3.5" />
        复制路径
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleSendToTerminal}>
        <Terminal className="size-3.5" />
        添加路径到终端
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
