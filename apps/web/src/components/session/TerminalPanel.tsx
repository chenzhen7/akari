import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/stores/session-store'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'
import { terminalBus } from '@/lib/terminalBus'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface TerminalPanelProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

export function TerminalPanel({ session, send }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalReadyTick = useSessionStore(s => s.terminalReadyTick[session.id] ?? 0)

  // Initialize xterm.js and subscribe to terminalBus — re-runs only when session ID changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      scrollback: 5000,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#e6edf3',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(container)

    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
        send({
          event: 'terminal:resize',
          payload: { sessionId: session.id, cols: term.cols, rows: term.rows },
        })
      } catch { /* ignore if disposed */ }
    })

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Subscribe first so no streaming data is missed during the history fetch
    let historyLoaded = false
    let pendingChunks: string[] = []
    let fetchAborted = false

    const unsubscribe = terminalBus.on(session.id, data => {
      if (historyLoaded) {
        term.write(data)
      } else {
        pendingChunks.push(data)
      }
    })

    // Always fetch full history from server (survives page refresh)
    fetch(`${API_BASE}/sessions/${session.id}/terminal-buffer`)
      .then(r => r.json())
      .then(({ buffer }: { buffer: string[] }) => {
        if (fetchAborted) return
        buffer.forEach(chunk => term.write(chunk))
        pendingChunks = []  // server buffer already contains this data
        historyLoaded = true
      })
      .catch((err: unknown) => {
        console.error('[TerminalPanel] failed to fetch terminal buffer:', err)
      })

    // Forward keystrokes to backend PTY
    term.onData(data => {
      send({ event: 'terminal:input', payload: { sessionId: session.id, data } })
    })

    // Sync PTY dimensions on container resize
    const ro = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        send({
          event: 'terminal:resize',
          payload: { sessionId: session.id, cols: term.cols, rows: term.rows },
        })
      } catch { /* ignore if disposed */ }
    })
    ro.observe(container)

    return () => {
      fetchAborted = true
      pendingChunks = []
      unsubscribe()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Re-sync PTY size when terminal:ready is received from server (PTY just created)
  useEffect(() => {
    if (terminalReadyTick === 0) return
    const fit = fitAddonRef.current
    const term = termRef.current
    if (!fit || !term) return
    try {
      fit.fit()
      send({
        event: 'terminal:resize',
        payload: { sessionId: session.id, cols: term.cols, rows: term.rows },
      })
    } catch { /* ignore */ }
  }, [terminalReadyTick, session.id, send])

  function handleClear() {
    terminalBus.clear(session.id)
    termRef.current?.clear()
  }

  return (
    <div className="flex h-full flex-col" style={{ background: '#0d1117' }}>
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">终端</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleClear}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
