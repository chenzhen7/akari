import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'
import { TaskPanel } from './TaskPanel'
import { TerminalPanel } from './TerminalPanel'

export function SessionDetail() {
  const activeTabId = useSessionStore(s => s.activeTabId)
  const sessions = useSessionStore(s => s.sessions)
  const setActiveTab = useSessionStore(s => s.setActiveTab)
  const addTerminalLine = useSessionStore(s => s.addTerminalLine)
  const [message, setMessage] = useState('')

  const session = sessions.find(s => s.id === activeTabId)
  if (!session) return null

  function sendMessage() {
    if (!session || !message.trim()) return
    addTerminalLine(session.id, `$ user: ${message}`)
    addTerminalLine(session.id, '> Processing your message...')
    setMessage('')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => setActiveTab(null)}
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-medium">{session.name}</span>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top section */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Task info */}
          <div className="w-1/2 overflow-auto border-r border-border p-4">
            <TaskPanel session={session} />
          </div>

          {/* Right: Diff summary */}
          <div className="w-1/2 overflow-auto p-4">
            <h3 className="mb-2 text-sm font-semibold">Git Diff</h3>
            {session.diffSummary ? (
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
                {session.diffSummary}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">暂无变更</p>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div className="h-[40%] border-t border-border">
          <TerminalPanel session={session} />
        </div>
      </div>

      {/* Message input */}
      <div className="flex gap-2 border-t border-border px-4 py-2">
        <Input
          placeholder="向此 Agent 发送消息..."
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          className="flex-1"
        />
        <Button onClick={sendMessage}>发送</Button>
      </div>
    </div>
  )
}
