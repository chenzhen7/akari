import { useState, useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Trash2, Pause, Play } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'

const MOCK_LINES = [
  '> Analyzing codebase...',
  '> Reading configuration...',
  '> Processing request...',
  '> Generating response...',
  '> Optimizing output...',
  '> Done.',
]

interface TerminalPanelProps {
  session: AgentSession
}

export function TerminalPanel({ session }: TerminalPanelProps) {
  const addTerminalLine = useSessionStore(s => s.addTerminalLine)
  const clearTerminal = useSessionStore(s => s.clearTerminal)
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [session.terminalOutput])

  // Simulate terminal output
  useEffect(() => {
    if (paused || session.status !== 'running') return
    const interval = setInterval(() => {
      const line = MOCK_LINES[Math.floor(Math.random() * MOCK_LINES.length)]
      addTerminalLine(session.id, line)
    }, 3000)
    return () => clearInterval(interval)
  }, [paused, session.status, session.id, addTerminalLine])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium">终端</span>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setPaused(p => !p)}
          >
            {paused ? (
              <Play className="h-3 w-3" />
            ) : (
              <Pause className="h-3 w-3" />
            )}
          </Button>
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
        <div ref={scrollRef} className="space-y-0.5 p-3 font-mono text-xs">
          {session.terminalOutput.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap text-muted-foreground">
              {line}
            </div>
          ))}
          <div className="animate-pulse text-muted-foreground">_</div>
        </div>
      </ScrollArea>
    </div>
  )
}
