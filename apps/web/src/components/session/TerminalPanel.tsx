import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/stores/session-store'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'
import { terminalBus } from '@/lib/terminalBus'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface TerminalPanelProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  unsubscribe: () => void
}

// Module-level registry: keeps Terminal instances alive across tab switches.
// Instances are never disposed until the session is explicitly destroyed.
const terminalInstances = new Map<string, TerminalEntry>()

export function TerminalPanel({ session, send }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalReadyTick = useSessionStore(s => s.terminalReadyTick[session.id] ?? 0)

  // Mount/unmount effect — re-runs only when session ID changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const existing = terminalInstances.get(session.id)

    if (existing) {
      // Tab switched back: re-attach the existing terminal element to the new container
      if (existing.term.element) {
        container.appendChild(existing.term.element)
      }
      requestAnimationFrame(() => {
        try {
          existing.fitAddon.fit()
          send({
            event: 'terminal:resize',
            payload: { sessionId: session.id, cols: existing.term.cols, rows: existing.term.rows },
          })
        } catch { /* ignore if disposed */ }
      })

      let resizeTimer: ReturnType<typeof setTimeout> | null = null
      const ro = new ResizeObserver(() => {
        try { existing.fitAddon.fit() } catch { /* ignore if disposed */ }
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          resizeTimer = null
          try {
            existing.term.write('\x1b[2J\x1b[H')
            send({
              event: 'terminal:resize',
              payload: { sessionId: session.id, cols: existing.term.cols, rows: existing.term.rows },
            })
          } catch { /* ignore if disposed */ }
        }, 100)
      })
      ro.observe(container)

      return () => {
        if (resizeTimer) clearTimeout(resizeTimer)
        ro.disconnect()
        // Detach element from DOM but keep the instance alive in the registry
        if (existing.term.element && container.contains(existing.term.element)) {
          container.removeChild(existing.term.element)
        }
      }
    }

    // First mount for this session: create a new terminal instance
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

    // Subscribe first so no streaming data is missed during the history fetch.
    // This subscription is persistent — it stays alive as long as the session exists.
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

    // Fetch full history from server once (survives page refresh on first mount)
    fetch(`${API_BASE}/sessions/${session.id}/terminal-buffer`)
      .then(r => r.json())
      .then(({ buffer }: { buffer: string[] }) => {
        if (fetchAborted) {
          unsubscribe()
          term.dispose()
          return
        }
        // Skip TUI full-screen animation frames (\x1b[H = cursor home).
        // These frames re-render the entire conversation history each tick;
        // replaying them in xterm.js pushes duplicate history into scrollback.
        // The current screen state is restored by \x1b[2J\x1b[H + ConPTY dump below.
        buffer
          .filter(chunk => !chunk.includes('\x1b[H'))
          .forEach(chunk => term.write(chunk))
        term.write('\x1b[2J\x1b[H')  // clear active screen (keeps scrollback); ConPTY dump fills it fresh
        // Write pending chunks AFTER clearing: if ConPTY dump arrived before fetch completed
        // (a race condition), it would have been buffered in pendingChunks and must not be
        // discarded — its \x1b[H will correctly repaint the active screen from (0,0).
        const pending = pendingChunks
        pendingChunks = []
        historyLoaded = true
        pending.forEach(chunk => term.write(chunk))

        // Register in the module-level registry only after history is fully loaded.
        // Subsequent mounts (tab switches) will find the entry and skip the server fetch.
        terminalInstances.set(session.id, { term, fitAddon, unsubscribe })
      })
      .catch((err: unknown) => {
        console.error('[TerminalPanel] failed to fetch terminal buffer:', err)
      })

    // Forward keystrokes to backend PTY
    term.onData(data => {
      send({ event: 'terminal:input', payload: { sessionId: session.id, data } })
    })

    // Sync PTY dimensions on container resize (debounced to prevent rapid ConPTY dumps)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit() } catch { /* ignore if disposed */ }
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        try {
          if (historyLoaded) term.write('\x1b[2J\x1b[H')  // clear before ConPTY dump
          send({
            event: 'terminal:resize',
            payload: { sessionId: session.id, cols: term.cols, rows: term.rows },
          })
        } catch { /* ignore if disposed */ }
      }, 100)
    })
    ro.observe(container)

    return () => {
      fetchAborted = true
      pendingChunks = []
      if (resizeTimer) clearTimeout(resizeTimer)
      ro.disconnect()

      if (terminalInstances.has(session.id)) {
        // History finished loading before unmount — just detach from DOM, keep instance alive
        const entry = terminalInstances.get(session.id)!
        if (entry.term.element && container.contains(entry.term.element)) {
          container.removeChild(entry.term.element)
        }
      } else {
        // Unmounted before history fetch completed — full cleanup
        unsubscribe()
        term.dispose()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Re-sync PTY size when terminal:ready is received from server (PTY just created)
  useEffect(() => {
    if (terminalReadyTick === 0) return
    const entry = terminalInstances.get(session.id)
    if (!entry) return
    try {
      entry.fitAddon.fit()
      send({
        event: 'terminal:resize',
        payload: { sessionId: session.id, cols: entry.term.cols, rows: entry.term.rows },
      })
    } catch { /* ignore */ }
  }, [terminalReadyTick, session.id, send])

  return (
    <div className="h-full" style={{ background: '#0d1117' }}>
      <div ref={containerRef} className="h-full overflow-hidden" />
    </div>
  )
}

/** Call when a session is permanently deleted to free xterm resources. */
export function destroyTerminalInstance(sessionId: string): void {
  const entry = terminalInstances.get(sessionId)
  if (entry) {
    entry.unsubscribe()
    entry.term.dispose()
    terminalInstances.delete(sessionId)
  }
}
