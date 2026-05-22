import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'

interface TerminalPanelProps {
  session: AgentSession
}

export function TerminalPanel({ session }: TerminalPanelProps) {
  const clearTerminal = useSessionStore(s => s.clearTerminal)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session.terminalOutput])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium">终端</span>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => clearTerminal(session.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-3 font-mono text-xs">
          {session.terminalOutput.length === 0 ? (
            <span className="text-muted-foreground/50">等待终端输出...</span>
          ) : (
            session.terminalOutput.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap text-muted-foreground leading-5">
                {line}
              </div>
            ))
          )}
          <div className="animate-pulse text-muted-foreground">_</div>
        </div>
      </ScrollArea>
    </div>
  )
}
