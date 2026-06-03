import { TerminalPanel } from './TerminalPanel'
import { DiffViewer } from '@/components/diff/DiffViewer'
import { FileEditor } from '@/components/editor/FileEditor'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'

interface TabContentProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

export function TabContent({ session, send }: TabContentProps) {
  const activeTab = session.tabs.find(t => t.id === session.activeTabId)

  if (!activeTab) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-sm">暂无标签页</p>
        <p className="text-xs opacity-60">点击右上角 + 新建终端</p>
      </div>
    )
  }

  if (activeTab.type === 'terminal' || activeTab.type === 'claude') {
    return (
      <TerminalPanel
        sessionId={session.id}
        terminalId={activeTab.terminalId!}
        send={send}
      />
    )
  }

  if (activeTab.type === 'diff') {
    return (
      <DiffViewer
        session={session}
        filePath={activeTab.filePath!}
      />
    )
  }

  if (activeTab.type === 'file') {
    return (
      <FileEditor
        session={session}
        filePath={activeTab.filePath!}
      />
    )
  }

  return null
}
