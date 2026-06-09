import { memo } from 'react'
import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { FileEditor } from '@/components/editor/FileEditor'
import { cn } from '@/lib/utils'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'

interface TabContentProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

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
        <div
          key={tab.id}
          className={cn(
            'absolute inset-0',
            tab.id !== activeTabId && 'hidden',
          )}
        >
          {(tab.type === 'terminal' || tab.type === 'claude') && (
            <TerminalPanel
              sessionId={session.id}
              terminalId={tab.terminalId!}
              send={send}
            />
          )}
          {tab.type === 'diff' && (
            <DiffViewer
              session={session}
              filePath={tab.filePath!}
            />
          )}
          {tab.type === 'file' && (
            <FileEditor
              session={session}
              filePath={tab.filePath!}
            />
          )}
        </div>
      ))}
    </div>
  )
})
