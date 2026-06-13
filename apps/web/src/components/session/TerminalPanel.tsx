import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/stores/session-store'
import { useTheme } from '@/components/theme-provider'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ClientMessage } from '@akari/shared-types'
import { terminalBus } from '@/lib/terminalBus'
import { resizeMutex } from '@/lib/ptyResizeMutex'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface TerminalPanelProps {
  sessionId: string
  terminalId: string
  send: (msg: ClientMessage) => void
}

interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  unsubscribeData: () => void
  unsubscribeResized: () => void
}

const DARK_THEME = {
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
}

const LIGHT_THEME = {
  background: '#fafafa',
  foreground: '#333333',
  cursor: '#333333',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#008000',
  yellow: '#795e26',
  blue: '#0070c1',
  magenta: '#af00db',
  cyan: '#098658',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#008000',
  brightYellow: '#795e26',
  brightBlue: '#0070c1',
  brightMagenta: '#af00db',
  brightCyan: '#098658',
  brightWhite: '#000000',
}

/** Module-level registry: keeps Terminal instances alive across tab switches. */
const terminalInstances = new Map<string, TerminalEntry>()

// DEBUG: helper to inspect instance / DOM state
function logTerminalState(label: string, terminalId: string, container?: HTMLDivElement | null) {
  const entry = terminalInstances.get(terminalId)
  const inContainer = container ? container.querySelectorAll('.xterm').length : 'n/a'
  const inDoc = typeof document !== 'undefined' ? document.querySelectorAll('.xterm').length : 'n/a'
  console.log(
    `[TERMINAL_DEBUG] ${label} | terminalId=${terminalId} | instances=${terminalInstances.size} ` +
    `| hasEntry=${!!entry} | termElementInContainer=${inContainer} | totalXtermRoots=${inDoc}`
  )
}

function getXtermTheme(isDark: boolean) {
  return isDark ? DARK_THEME : LIGHT_THEME
}

function updateTerminalTheme(terminalId: string, isDark: boolean) {
  const entry = terminalInstances.get(terminalId)
  if (!entry) return
  try {
    entry.term.options.theme = getXtermTheme(isDark)
  } catch { /* ignore if disposed */ }
}

export function TerminalPanel({ sessionId, terminalId, send }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalReadyTick = useSessionStore(s => s.terminalReadyTick[terminalId] ?? 0)
  const { theme: appTheme } = useTheme()
  const isDark = appTheme === 'dark'

  /* ─── Mount / unmount ─────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current
    logTerminalState('mount effect start', terminalId, container)
    if (!container) {
      console.log(`[TERMINAL_DEBUG] mount effect early return: container is null for ${terminalId}`)
      return
    }

    const existing = terminalInstances.get(terminalId)

    if (existing) {
      // Tab switched back: re-attach DOM element
      console.log(`[TERMINAL_DEBUG] re-attach existing terminal ${terminalId}`)
      if (existing.term.element) {
        container.appendChild(existing.term.element)
      }
      requestAnimationFrame(() => {
        try {
          existing.fitAddon.fit()
          existing.term.focus()
        } catch { /* ignore if disposed */ }
        logTerminalState('after re-attach fit', terminalId, container)
      })
    } else {
      // First mount: create a fresh terminal
      console.log(`[TERMINAL_DEBUG] create new terminal ${terminalId}`)
      createTerminal(sessionId, terminalId, container, send, isDark)
    }

    return () => {
      // Detach DOM element but keep the instance alive
      logTerminalState('cleanup start', terminalId, container)
      const entry = terminalInstances.get(terminalId)
      if (entry?.term.element && container.contains(entry.term.element)) {
        container.removeChild(entry.term.element)
        console.log(`[TERMINAL_DEBUG] detached terminal ${terminalId} from container`)
      }
      logTerminalState('cleanup end', terminalId, container)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId])

  /* ─── Theme change ────────────────────────────────────────────────────── */

  useEffect(() => {
    updateTerminalTheme(terminalId, isDark)
  }, [isDark, terminalId])

  /* ─── Terminal:ready from server ──────────────────────────────────────── */

  useEffect(() => {
    if (terminalReadyTick === 0) return
    const entry = terminalInstances.get(terminalId)
    console.log(`[TERMINAL_DEBUG] terminal:ready tick=${terminalReadyTick} terminalId=${terminalId} hasEntry=${!!entry}`)
    if (!entry) return
    try {
      entry.fitAddon.fit()
      entry.term.focus()
    } catch { /* ignore */ }
  }, [terminalReadyTick, terminalId])

  /* ─── ResizeObserver (debounced) — set up on every mount ──────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const entry = terminalInstances.get(terminalId)
    if (!entry) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const ro = new ResizeObserver(() => {
      console.log(`[TERMINAL_DEBUG] ResizeObserver fired terminalId=${terminalId}`)
      try { entry.fitAddon.fit() } catch { /* ignore */ }

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        // Coalesce rapid resize events: acquire() returns false if a resize
        // is already in flight for this terminal.
        if (!resizeMutex.acquire(terminalId)) return
        try {
          const { cols, rows } = entry.term
          console.log(`[TERMINAL_DEBUG] sending resize terminalId=${terminalId} cols=${cols} rows=${rows}`)
          send({ event: 'terminal:resize', payload: { sessionId, terminalId, cols, rows } })
        } catch { /* ignore if disposed */ }
      }, 150)
    })
    ro.observe(container)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      ro.disconnect()
    }
  }, [terminalId, sessionId, send])

  return (
    <div className="h-full p-2" style={{ background: isDark ? DARK_THEME.background : LIGHT_THEME.background }}>
      <div ref={containerRef} className="h-full overflow-hidden" />
    </div>
  )
}

/* ─── Terminal creation (runs once per terminalId) ──────────────────────── */

function createTerminal(
  sessionId: string,
  terminalId: string,
  container: HTMLDivElement,
  send: (msg: ClientMessage) => void,
  isDark: boolean,
): void {
  console.log(`[TERMINAL_DEBUG] createTerminal start terminalId=${terminalId}`)
  logTerminalState('createTerminal before new Terminal', terminalId, container)

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"Cascadia Code", "Fira Code", Menlo, "Courier New", monospace',
    fontSize: 12,
    lineHeight: 1.4,
    scrollback: 5000,
    theme: getXtermTheme(isDark),
  })

  const fitAddon = new FitAddon()
  const webLinksAddon = new WebLinksAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(webLinksAddon)
  term.open(container)
  logTerminalState('createTerminal after term.open', terminalId, container)

  requestAnimationFrame(() => {
    try {
      fitAddon.fit()
      term.focus()
      send({ event: 'terminal:resize', payload: { sessionId, terminalId, cols: term.cols, rows: term.rows } })
    } catch { /* ignore if disposed */ }
    logTerminalState('createTerminal after initial fit', terminalId, container)
  })

  // Keystrokes → backend PTY
  term.onData(data => {
    send({ event: 'terminal:input', payload: { sessionId, terminalId, data } })
  })

  // ── Subscribe to terminal:data events (buffered during resize) ──────────
  let historyLoaded = false
  let pendingChunks: string[] = []

  const unsubscribeData = terminalBus.on(terminalId, data => {
    if (resizeMutex.buffer(terminalId, data)) return  // buffered during resize
    if (historyLoaded) {
      term.write(data)
    } else {
      pendingChunks.push(data)
    }
  })

  // ── Subscribe to terminal:resized: flush buffered data ─────────────────
  const unsubscribeResized = terminalBus.onResized(terminalId, () => {
    const entry = terminalInstances.get(terminalId)
    if (!entry) return
    const buffered = resizeMutex.release(terminalId)
    if (buffered.length > 0) {
      term.write(buffered.join(''))
    }
    try {
      term.scrollToBottom()
    } catch { /* ignore */ }
  })

  // Register immediately so tab-switch cleanup can always find and detach the DOM.
  terminalInstances.set(terminalId, { term, fitAddon, unsubscribeData, unsubscribeResized })
  logTerminalState('createTerminal after register', terminalId, container)

  // ── Fetch history from server ──────────────────────────────────────────
  fetch(`${API_BASE}/sessions/${sessionId}/terminal-buffer?terminalId=${terminalId}`)
    .then(r => r.json())
    .then(({ buffer }: { buffer: string[] }) => {
      logTerminalState(`createTerminal history fetched (${buffer.length} chunks)`, terminalId, container)
      // Skip TUI animation frames (\x1b[H = cursor home) that would push
      // duplicate history into scrollback on replay.
      buffer
        .filter(chunk => !chunk.includes('\x1b[H'))
        .forEach(chunk => term.write(chunk))

      // Flush any data that arrived during the fetch
      historyLoaded = true
      const pending = pendingChunks.splice(0)
      pending.forEach(chunk => term.write(chunk))
    })
    .catch((err: unknown) => {
      console.error('[TerminalPanel] failed to fetch terminal buffer:', err)
      // Even on error mark history as loaded so new PTY data flows through.
      historyLoaded = true
      const pending = pendingChunks.splice(0)
      pending.forEach(chunk => term.write(chunk))
    })
}

/* ─── Public helpers ─────────────────────────────────────────────────────── */

/**
 * Read the last `maxLines` non-empty lines from the currently visible xterm viewport.
 * Returns [] if the terminal instance hasn't been created yet.
 */
export function getTerminalViewportLines(terminalId: string, maxLines = 5): string[] {
  const entry = terminalInstances.get(terminalId)
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

/** Call when a terminal tab is closed to free xterm resources. */
export function destroyTerminalInstance(terminalId: string): void {
  console.log(`[TERMINAL_DEBUG] destroyTerminalInstance terminalId=${terminalId}`)
  const entry = terminalInstances.get(terminalId)
  if (entry) {
    entry.unsubscribeData()
    entry.unsubscribeResized()
    entry.term.dispose()
    terminalInstances.delete(terminalId)
  }
  resizeMutex.release(terminalId) // drain any residual buffer
  logTerminalState('after destroy', terminalId)
}
