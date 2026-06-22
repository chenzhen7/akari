import { memo } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { FileEditor } from '@/components/editor/FileEditor'
import { cn } from '@/lib/utils'
import type { AgentSession, DiffFile, SessionTab } from '@/types'
import type { ClientMessage } from '@akari/shared-types'

const EMPTY_DIFF_FILES: DiffFile[] = []

interface TabContentProps {
  session: AgentSession
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
      {(type === 'terminal' || type === 'claude') && terminalId && (
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

export const TabContent = memo(function TabContent({ session, send }: TabContentProps) {
  const activeTabId = session.activeTabId

  if (session.tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-sm">暂无标签页</p>
        <p className="text-xs opacity-60">点击右上角 + 新建终端</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {session.tabs.map(tab => (
        <TabPane
          key={tab.id}
          sessionId={session.id}
          type={tab.type}
          terminalId={tab.terminalId}
          filePath={tab.filePath}
          isActive={tab.id === activeTabId}
          send={send}
          diffFiles={tab.type === 'diff' ? session.diffFiles ?? EMPTY_DIFF_FILES : undefined}
          workspaceId={session.workspaceId}
          worktreePath={session.worktreePath}
        />
      ))}
    </div>
  )
})
