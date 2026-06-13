import { memo } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { FileEditor } from '@/components/editor/FileEditor'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'

interface TabContentProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

export const TabContent = memo(function TabContent({ session, send }: TabContentProps) {
  const activeTab = session.tabs.find(t => t.id === session.activeTabId)

  if (!activeTab) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-sm">暂无标签页</p>
        <p className="text-xs opacity-60">点击右上角 + 新建终端</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0">
        {(activeTab.type === 'terminal' || activeTab.type === 'claude') && (
          <TerminalPanel
            sessionId={session.id}
            terminalId={activeTab.terminalId!}
            send={send}
          />
        )}
        {activeTab.type === 'diff' && (
          <DiffViewer
            session={session}
            filePath={activeTab.filePath!}
          />
        )}
        {activeTab.type === 'file' && (
          <FileEditor
            session={session}
            filePath={activeTab.filePath!}
          />
        )}
      </div>
    </div>
  )
})
