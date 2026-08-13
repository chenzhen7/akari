import { useEffect, useRef } from 'react'
import { useConnectionStore } from '@/features/terminal/stores/connection-store'
import { useTheme } from '@/shared/components/theme-provider'
import { Terminal, type IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ClientMessage } from '@akari/shared-types'
import { terminalBus } from '@/features/terminal/lib/terminalBus'
import { resizeMutex } from '@/shared/lib/ptyResizeMutex'
import { attachImeAnchor } from '@/shared/lib/xterm-ime-anchor'
import { apiClient } from '@/shared/lib/api-client'
import { terminalInstances, type TerminalEntry } from '@/features/session/lib/terminal-instances'
import { perfMark, perfMeasure } from '@/shared/lib/perf-log'

interface TerminalPanelProps {
  sessionId: string
  terminalId: string
  send: (msg: ClientMessage) => void
  isActive?: boolean
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
  background: '#ffffff',
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

/**
 * Atomically re-fit the terminal and notify the backend of the new size.
 *
 * The client buffer and the PTY must change size together: if the client
 * resizes first, a TUI redraws at its old width into the newly-sized buffer
 * and text lands garbled/overlapping until the next full frame. Running
 * acquire() before fit() also means the resize-mutex buffers any data that
 * arrives mid-resize instead of letting it render at the wrong size.
 */
function fitAndSendResize(
  entry: TerminalEntry,
  sessionId: string,
  terminalId: string,
  send: (msg: ClientMessage) => void,
): void {
  // Coalesce rapid resizes: if one is already in flight, it owns this fit.
  if (!resizeMutex.acquire(terminalId)) return
  try {
    entry.fitAddon.fit()
    const { cols, rows } = entry.term
    send({ event: 'terminal:resize', payload: { sessionId, terminalId, cols, rows } })
  } catch {
    // fit() can throw on a zero-size container (hidden tab) — don't leave the
    // resize lock stuck for this terminal.
    resizeMutex.release(terminalId)
  }
}

export function TerminalPanel({ sessionId, terminalId, send, isActive }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalReadyTick = useConnectionStore(s => s.terminalReadyTick[terminalId] ?? 0)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  /* ─── Focus / fit when this tab becomes active ────────────────────────── */

  useEffect(() => {
    if (!isActive) return
    const entry = terminalInstances.get(terminalId)
    if (!entry) return
    requestAnimationFrame(() => {
      try {
        fitAndSendResize(entry, sessionId, terminalId, send)
        entry.term.focus()
      } catch { /* ignore if disposed */ }
    })
  }, [isActive, terminalId, sessionId, send])

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
          fitAndSendResize(existing, sessionId, terminalId, send)
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
      fitAndSendResize(entry, sessionId, terminalId, send)
      entry.term.focus()
    } catch { /* ignore */ }
  }, [terminalReadyTick, terminalId, sessionId, send])

  /* ─── ResizeObserver (debounced) — set up on every mount ──────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const entry = terminalInstances.get(terminalId)
    if (!entry) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const ro = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        // Debounced so rapid resize events coalesce. fit() + backend resize
        // run atomically inside fitAndSendResize (see its doc comment).
        fitAndSendResize(entry, sessionId, terminalId, send)
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
  const perfKey = `terminal:${terminalId}`
  perfMark(perfKey, `终端开始创建 ${terminalId}`)

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
  //
  // xterm.js 会自动应答终端查询（Device Attributes / DECID），应答经 onData 抛出，
  // 与真实按键混在一起。若转发回真实 PTY 会被 shell 回显成垃圾字符——恢复会话重放
  // 历史时最明显：历史里的 ESC[c 查询被重新解析 → 再次应答 → 回显，屏幕多出
  // "[?1;2c"。真实 PTY（ConPTY）负责能力协商，xterm 的 DA 应答必须丢弃。
  // （注意：CPR 等光标应答不能过滤，Claude Code 依赖它读光标位置。）
  const XTERM_DA_RESPONSES = new Set([
    '\x1b[?1;2c', // 主 DA（xterm / DECID）
    '\x1b[?6c', // 主 DA（linux）
    '\x1b[>0;276;0c', // 二级 DA（xterm）
    '\x1b[>83;40003;0c', // 二级 DA（rxvt-unicode）
    '\x1b[>85;95;0c', // 二级 DA（linux）
  ])
  term.onData(data => {
    if (XTERM_DA_RESPONSES.has(data)) return
    send({ event: 'terminal:input', payload: { sessionId, terminalId, data } })
  })

  // ── Subscribe to terminal:data events (buffered during resize) ──────────
  let historyLoaded = false
  let firstDataLogged = false
  const pendingChunks: string[] = []

  const unsubscribeData = terminalBus.on(terminalId, data => {
    if (!firstDataLogged) {
      firstDataLogged = true
      perfMeasure(perfKey, '终端收到第一帧 PTY 数据（创建 → 首个 terminal:data）')
    }
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
      // Defensive repaint: after a resize the app redraws at the new size, but
      // the renderer can keep stale/overlapping glyphs from the old frame.
      // Force a full re-render of the visible viewport to clear orphaned cells
      // (alt-screen TUIs are the worst offenders).
      term.refresh(0, term.rows - 1)
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
  apiClient.get<{ buffer: string[] }>(`/sessions/${sessionId}/terminal-buffer`, {
    params: { terminalId },
    toast: false,
  })
    .then(({ buffer }) => {
      perfMeasure(perfKey, 'terminal-buffer 历史响应返回（HTTP 耗时）')
      // Replay history faithfully. Do NOT drop chunks containing \x1b[H — a
      // TUI frame is often split across chunk boundaries, so dropping one half
      // breaks the cursor-positioning context of the rest and garbles the
      // screen. Instead, if the buffer currently ends inside the alt-screen
      // buffer (a running TUI like Claude Code fullscreen), truncate the
      // replay to the pre-TUI history and let live terminal:data repaint the
      // TUI screen.
      const all = buffer.join('')
      const lastAltEnter = all.lastIndexOf('\x1b[?1049h')
      const lastAltExit = all.lastIndexOf('\x1b[?1049l')
      if (lastAltEnter > lastAltExit) {
        term.write(all.slice(0, lastAltEnter))
        term.write('\x1b[?1049h') // re-enter alt-screen so live frames render in place
      } else {
        term.write(all)
      }

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
