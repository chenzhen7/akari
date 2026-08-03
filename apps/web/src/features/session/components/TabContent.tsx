import { memo, useEffect, useState } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/features/diff/components/DiffViewer'
import { FileEditor } from '@/features/explorer/components/FileEditor'
import { cn } from '@/shared/lib/utils'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { findSession } from '@/features/session/stores/session-store'
import { useShallow } from 'zustand/react/shallow'
import type { DiffFile, SessionTab } from '@/shared/types'
import type { ClientMessage } from '@akari/shared-types'

const EMPTY_DIFF_FILES: DiffFile[] = []

interface TabContentProps {
  sessionId: string
  send: (msg: ClientMessage) => void
}

interface TabPaneProps {
  sessionId: string
  type: SessionTab['type']
  terminalId?: string
  filePath?: string
  isActive: boolean
  send: (msg: ClientMessage) => void
  diffFiles?: DiffFile[]
  workspaceId: string
  worktreePath: string
}

const TabPane = memo(function TabPane({
  sessionId,
  type,
  terminalId,
  filePath,
  isActive,
  send,
  diffFiles,
  workspaceId,
  worktreePath,
}: TabPaneProps) {
  return (
    <div
      className={cn(
        'absolute inset-0',
        !isActive && 'hidden',
      )}
    >
      {(type === 'terminal' || type === 'agent') && terminalId && (
        <TerminalPanel
          sessionId={sessionId}
          terminalId={terminalId}
          send={send}
          isActive={isActive}
        />
      )}
      {type === 'diff' && filePath && (
        <DiffViewer
          sessionId={sessionId}
          filePath={filePath}
          diffFiles={diffFiles ?? EMPTY_DIFF_FILES}
          workspaceId={workspaceId}
          worktreePath={worktreePath}
          isActive={isActive}
        />
      )}
      {type === 'file' && filePath && (
        <FileEditor
          sessionId={sessionId}
          filePath={filePath}
          workspaceId={workspaceId}
          worktreePath={worktreePath}
          isActive={isActive}
        />
      )}
    </div>
  )
})

export const TabContent = memo(function TabContent({ sessionId, send }: TabContentProps) {
  const { tabs, activeTabId, workspaceId, worktreePath, diffFiles } = useWorkspaceStore(
    useShallow(s => {
      const session = findSession(s.workspaceSessions, sessionId)
      if (!session) {
        return {
          tabs: [] as SessionTab[],
          activeTabId: null as string | null,
          workspaceId: '',
          worktreePath: '',
          diffFiles: EMPTY_DIFF_FILES,
        }
      }
      return {
        tabs: session.tabs,
        activeTabId: session.activeTabId,
        workspaceId: session.workspaceId,
        worktreePath: session.worktreePath,
        diffFiles: session.diffFiles ?? EMPTY_DIFF_FILES,
      }
    }),
  )

  // Keep-alive: once a tab has been rendered, keep its component mounted
  // and hidden via CSS so switching back is instant (same approach VS Code
  // uses for editor panes: editor instances stay alive and are shown/hidden).
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(
    () => new Set(activeTabId ? [activeTabId] : []),
  )

  useEffect(() => {
    if (!activeTabId) return
    setMountedTabIds(prev => {
      if (prev.has(activeTabId)) return prev
      return new Set([...prev, activeTabId])
    })
  }, [activeTabId])

  // Remove unmounted tab ids when tabs are closed so memory can be reclaimed.
  useEffect(() => {
    const currentTabIds = new Set(tabs.map(t => t.id))
    setMountedTabIds(prev => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (currentTabIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [tabs])

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-sm">暂无标签页</p>
        <p className="text-xs opacity-60">点击右上角 + 新建终端</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {tabs.map(tab => {
        if (!mountedTabIds.has(tab.id)) return null
        return (
          <TabPane
            key={tab.id}
            sessionId={sessionId}
            type={tab.type}
            terminalId={tab.terminalId}
            filePath={tab.filePath}
            isActive={tab.id === activeTabId}
            send={send}
            diffFiles={tab.type === 'diff' ? diffFiles : undefined}
            workspaceId={workspaceId}
            worktreePath={worktreePath}
          />
        )
      })}
    </div>
  )
})
