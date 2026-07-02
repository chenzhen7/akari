import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/stores/session-store'
import { useTheme } from '@/components/theme-provider'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ClientMessage } from '@akari/shared-types'
import { terminalBus } from '@/lib/terminalBus'
import { resizeMutex } from '@/lib/ptyResizeMutex'
import { attachImeAnchor } from '@/lib/xterm-ime-anchor'
import { API_BASE } from '@/lib/api'
import { terminalInstances } from './terminal-instances'

interface TerminalPanelProps {
  sessionId: string
  terminalId: string
  send: (msg: ClientMessage) => void
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
    if (!container) {
      return
    }

    const existing = terminalInstances.get(terminalId)

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
      createTerminal(sessionId, terminalId, container, send, isDark)
    }

    return () => {
      // Detach DOM element but keep the instance alive
      const entry = terminalInstances.get(terminalId)
      if (entry?.term.element && container.contains(entry.term.element)) {
        container.removeChild(entry.term.element)
      }
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
      try { entry.fitAddon.fit() } catch { /* ignore */ }

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        // Coalesce rapid resize events: acquire() returns false if a resize
        // is already in flight for this terminal.
        if (!resizeMutex.acquire(terminalId)) return
        try {
          const { cols, rows } = entry.term
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

async function writeTextToClipboard(text: string): Promise<void> {
  if (window.electron?.clipboard?.writeText) {
    await window.electron.clipboard.writeText(text)
    return
  }
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback for non-secure contexts or when the Clipboard API is unavailable.
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    const success = document.execCommand('copy')
    if (!success) {
      throw new Error('document.execCommand("copy") returned false')
    }
  } finally {
    document.body.removeChild(textarea)
  }
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Intercept OSC 52 clipboard-write sequences (used by Claude Code fullscreen
 * mode) and forward the payload to the browser's system clipboard.
 */
function installOsc52ClipboardHandler(term: Terminal): IDisposable {
  return term.parser.registerOscHandler(52, (data) => {
    const idx = data.indexOf(';')
    if (idx === -1) return false
    const payload = data.slice(idx + 1)
    if (!payload || payload === '?') return false
    try {
      const decoded = base64ToUtf8(payload)
      if (decoded) {
        writeTextToClipboard(decoded).catch((err: unknown) => {
          console.error('[TerminalPanel] failed to write OSC 52 clipboard:', err)
        })
      }
      return true
    } catch (err) {
      console.error('[TerminalPanel] failed to decode OSC 52 payload:', err)
      return false
    }
  })
}

function createTerminal(
  sessionId: string,
  terminalId: string,
  container: HTMLDivElement,
  send: (msg: ClientMessage) => void,
  isDark: boolean,
): void {
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

  // Bridge clipboard writes from the TUI (e.g. Claude Code fullscreen mode)
  // to the browser's system clipboard. In fullscreen mode Claude Code sends
  // OSC 52 sequences; xterm.js ignores them by default, so we intercept them
  // here and forward the payload to navigator.clipboard.
  const osc52Disposable = installOsc52ClipboardHandler(term)

  // Anchor IME composition elements to the visual caret for Ink-style TUIs
  // (e.g. Claude Code) which hide the hardware cursor and render a fake one.
  const { detach: detachImeAnchor } = attachImeAnchor(term)

  requestAnimationFrame(() => {
    try {
      fitAddon.fit()
      term.focus()
      send({ event: 'terminal:resize', payload: { sessionId, terminalId, cols: term.cols, rows: term.rows } })
    } catch { /* ignore if disposed */ }
  })

  // Keystrokes → backend PTY
  term.onData(data => {
    send({ event: 'terminal:input', payload: { sessionId, terminalId, data } })
  })

  // ── Subscribe to terminal:data events (buffered during resize) ──────────
  let historyLoaded = false
  const pendingChunks: string[] = []

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
  terminalInstances.set(terminalId, {
    term,
    fitAddon,
    unsubscribeData,
    unsubscribeResized,
    detachImeAnchor,
    disposeClipboardHandlers: () => {
      osc52Disposable.dispose()
    },
  })

  // ── Fetch history from server ──────────────────────────────────────────
  fetch(`${API_BASE}/sessions/${sessionId}/terminal-buffer?terminalId=${terminalId}`)
    .then(r => r.json())
    .then(({ buffer }: { buffer: string[] }) => {
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
