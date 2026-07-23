import { memo, useMemo } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/features/diff/components/DiffViewer'
import { FileEditor } from '@/features/explorer/components/FileEditor'
import { cn } from '@/shared/lib/utils'
import { useSessionStore } from '@/features/session/stores/session-store'
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

  const activeTab = useMemo(
    () => tabs.find(tab => tab.id === activeTabId) ?? null,
    [activeTabId, tabs],
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
      {activeTab && (
        <TabPane
          key={activeTab.id}
          sessionId={sessionId}
          type={activeTab.type}
          terminalId={activeTab.terminalId}
          filePath={activeTab.filePath}
          isActive
          send={send}
          diffFiles={activeTab.type === 'diff' ? diffFiles : undefined}
          workspaceId={workspaceId}
          worktreePath={worktreePath}
        />
      )}
    </div>
  )
})
