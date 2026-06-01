import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/stores/session-store'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { AgentSession } from '@/types'
import type { ClientMessage } from '@akari/shared-types'
import { terminalBus } from '@/lib/terminalBus'
import { resizeMutex } from '@/lib/ptyResizeMutex'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface TerminalPanelProps {
  session: AgentSession
  send: (msg: ClientMessage) => void
}

interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  unsubscribeData: () => void
  unsubscribeResized: () => void
}

/** Module-level registry: keeps Terminal instances alive across tab switches. */
const terminalInstances = new Map<string, TerminalEntry>()

export function TerminalPanel({ session, send }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalReadyTick = useSessionStore(s => s.terminalReadyTick[session.id] ?? 0)

  /* ─── Mount / unmount ─────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const existing = terminalInstances.get(session.id)

    if (existing) {
      // Tab switched back: re-attach DOM element
      if (existing.term.element) {
        container.appendChild(existing.term.element)
      }
      requestAnimationFrame(() => {
        try {
          existing.fitAddon.fit()
          existing.term.focus()
        } catch { /* ignore if disposed */ }
      })
    } else {
      // First mount: create a fresh terminal
      createTerminal(session.id, container, send)
    }

    return () => {
      // Detach DOM element but keep the instance alive
      const entry = terminalInstances.get(session.id)
      if (entry?.term.element && container.contains(entry.term.element)) {
        container.removeChild(entry.term.element)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  /* ─── Terminal:ready from server ──────────────────────────────────────── */

  useEffect(() => {
    if (terminalReadyTick === 0) return
    const entry = terminalInstances.get(session.id)
    if (!entry) return
    try {
      entry.fitAddon.fit()
      entry.term.focus()
    } catch { /* ignore */ }
  }, [terminalReadyTick, session.id])

  /* ─── ResizeObserver (debounced) — set up on every mount ──────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const entry = terminalInstances.get(session.id)
    if (!entry) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const ro = new ResizeObserver(() => {
      try { entry.fitAddon.fit() } catch { /* ignore */ }

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        // Coalesce rapid resize events: acquire() returns false if a resize
        // is already in flight for this session.
        if (!resizeMutex.acquire(session.id)) return
        try {
          const { cols, rows } = entry.term
          send({ event: 'terminal:resize', payload: { sessionId: session.id, cols, rows } })
        } catch { /* ignore if disposed */ }
      }, 150)
    })
    ro.observe(container)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      ro.disconnect()
    }
  }, [session.id])

  return (
    <div className="h-full p-2" style={{ background: '#1e1e1e' }}>
      <div ref={containerRef} className="h-full overflow-hidden" />
    </div>
  )
}

/* ─── Terminal creation (runs once per session) ─────────────────────────── */

function createTerminal(
  sessionId: string,
  container: HTMLDivElement,
  send: (msg: ClientMessage) => void,
): void {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Fira Code", Menlo, "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.4,
    scrollback: 5000,
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#aeafad',
      selectionBackground: '#264f78',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
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
      term.focus()
      send({ event: 'terminal:resize', payload: { sessionId, cols: term.cols, rows: term.rows } })
    } catch { /* ignore if disposed */ }
  })

  // Keystrokes → backend PTY
  term.onData(data => {
    send({ event: 'terminal:input', payload: { sessionId, data } })
  })

  // ── Subscribe to terminal:data events (buffered during resize) ──────────
  let historyLoaded = false
  let pendingChunks: string[] = []

  const unsubscribeData = terminalBus.on(sessionId, data => {
    if (resizeMutex.buffer(sessionId, data)) return  // buffered during resize
    if (historyLoaded) {
      term.write(data)
    } else {
      pendingChunks.push(data)
    }
  })

  // ── Subscribe to terminal:resized: flush buffered data ─────────────────
  const unsubscribeResized = terminalBus.onResized(sessionId, () => {
    const entry = terminalInstances.get(sessionId)
    if (!entry) return
    const buffered = resizeMutex.release(sessionId)
    if (buffered.length > 0) {
      term.write(buffered.join(''))
    }
    try {
      term.scrollToBottom()
    } catch { /* ignore */ }
  })

  // ── Fetch history from server ──────────────────────────────────────────
  let fetchAborted = false

  fetch(`${API_BASE}/sessions/${sessionId}/terminal-buffer`)
    .then(r => r.json())
    .then(({ buffer }: { buffer: string[] }) => {
      if (fetchAborted) {
        unsubscribeData()
        unsubscribeResized()
        term.dispose()
        return
      }

      // Skip TUI animation frames (\x1b[H = cursor home) that would push
      // duplicate history into scrollback on replay.
      buffer
        .filter(chunk => !chunk.includes('\x1b[H'))
        .forEach(chunk => term.write(chunk))

      // Flush any data that arrived during the fetch
      historyLoaded = true
      const pending = pendingChunks.splice(0)
      pending.forEach(chunk => term.write(chunk))

      // Register only after history is fully loaded so tab-switch mounts
      // find the entry and skip the fetch.
      terminalInstances.set(sessionId, { term, fitAddon, unsubscribeData, unsubscribeResized })
    })
    .catch((err: unknown) => {
      console.error('[TerminalPanel] failed to fetch terminal buffer:', err)
      // Still register on error so the terminal is usable
      terminalInstances.set(sessionId, { term, fitAddon, unsubscribeData, unsubscribeResized })
    })
}

/* ─── Public helpers ─────────────────────────────────────────────────────── */

/**
 * Read the last `maxLines` non-empty lines from the currently visible xterm viewport.
 * Returns [] if the terminal instance hasn't been created yet.
 */
export function getTerminalViewportLines(sessionId: string, maxLines = 5): string[] {
  const entry = terminalInstances.get(sessionId)
  if (!entry) return []
  const { term } = entry
  const buf = term.buffer.active
  const viewportY = buf.viewportY
  const viewportEnd = viewportY + term.rows - 1
  const result: string[] = []
  for (let row = viewportEnd; row >= viewportY && result.length < maxLines; row--) {
    const line = buf.getLine(row)
    if (!line) continue
    const text = line.translateToString(true).trimEnd()
    result.unshift(text)
  }
  return result
}

/** Call when a session is permanently deleted to free xterm resources. */
export function destroyTerminalInstance(sessionId: string): void {
  const entry = terminalInstances.get(sessionId)
  if (entry) {
    entry.unsubscribeData()
    entry.unsubscribeResized()
    entry.term.dispose()
    terminalInstances.delete(sessionId)
  }
  resizeMutex.release(sessionId) // drain any residual buffer
}
