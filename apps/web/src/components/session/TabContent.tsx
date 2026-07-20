import { memo, useEffect, useMemo, useState } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { FileEditor } from '@/components/editor/FileEditor'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/stores/session-store'
import { useShallow } from 'zustand/react/shallow'
import type { DiffFile, SessionTab } from '@/types'
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
        />
      )}
      {type === 'diff' && filePath && (
        <DiffViewer
          sessionId={sessionId}
          filePath={filePath}
          diffFiles={diffFiles ?? EMPTY_DIFF_FILES}
          workspaceId={workspaceId}
          worktreePath={worktreePath}
        />
      )}
      {type === 'file' && filePath && (
        <FileEditor
          sessionId={sessionId}
          filePath={filePath}
          workspaceId={workspaceId}
          worktreePath={worktreePath}
        />
      )}
    </div>
  )
})

export const TabContent = memo(function TabContent({ sessionId, send }: TabContentProps) {
  const { tabs, activeTabId, workspaceId, worktreePath, diffFiles } = useSessionStore(
    useShallow(s => {
      const session = s.sessions.find(ses => ses.id === sessionId)
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

  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setMountedTabIds(prev => {
      const validTabIds = new Set(tabs.map(tab => tab.id))
      const next = new Set<string>()
      for (const id of prev) {
        if (validTabIds.has(id)) {
          next.add(id)
        }
      }
      if (activeTabId) {
        next.add(activeTabId)
      }
      if (next.size === prev.size && [...next].every(id => prev.has(id))) {
        return prev
      }
      return next
    })
  }, [activeTabId, tabs])

  const visibleTabs = useMemo(
    () => tabs.filter(tab => tab.id === activeTabId || mountedTabIds.has(tab.id)),
    [activeTabId, mountedTabIds, tabs],
  )

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
      {visibleTabs.map(tab => (
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
      ))}
    </div>
  )
})
