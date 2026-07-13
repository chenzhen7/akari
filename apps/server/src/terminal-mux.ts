import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'

interface TerminalEntry {
  terminalId: string
  sessionId: string
  pty: pty.IPty
  buffer: string[]
  status: 'running' | 'exited'
  /** Temporary buffer for data that arrives while PTY is resizing */
  resizeBuffer: string[]
  /** Whether a resize is currently in-flight for this terminal */
  resizing: boolean
}

export class TerminalMultiplexer extends EventEmitter {
  private readonly terminals = new Map<string, TerminalEntry>()
  private readonly pendingResize = new Map<string, { cols: number; rows: number }>()
  private readonly BUFFER_LIMIT = 5000

  createTerminal(terminalId: string, sessionId: string, cwd: string): void {
    if (this.terminals.has(terminalId)) {
      console.log(`[TERMINAL_DEBUG_BACKEND] createTerminal skipped: ${terminalId} already exists`)
      return
    }

    console.log(`[TERMINAL_DEBUG_BACKEND] createTerminal terminalId=${terminalId} sessionId=${sessionId} cwd=${cwd}`)

    console.log(`[TERMINAL_DEBUG_BACKEND] createTerminal terminalId=${terminalId} sessionId=${sessionId} cwd=${cwd}`)

    const isWindows = process.platform === 'win32'
    // Prefer PowerShell 7+ (pwsh.exe); fall back to built-in Windows PowerShell 5.x
    const hasPwsh = existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    const shell = isWindows
      ? (hasPwsh ? 'pwsh.exe' : 'powershell.exe')
      : (process.env.SHELL ?? 'bash')
    const args = isWindows ? ['-NoLogo'] : ['--login']

    const pending = this.pendingResize.get(terminalId)
    const cols = pending?.cols ?? 80
    const rows = pending?.rows ?? 24
    this.pendingResize.delete(terminalId)

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        AGENT_SESSION_ID: sessionId,
        // Disable git/man pager so output streams directly in PTY
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        LESS: '-FRX',
      } as Record<string, string>,
    })

    const entry: TerminalEntry = { terminalId, sessionId, pty: proc, buffer: [], status: 'running', resizeBuffer: [], resizing: false }

    proc.onData((data: string) => {
      this.appendBuffer(entry, data)
      if (entry.resizing) {
        entry.resizeBuffer.push(data)
      } else {
        this.emit('terminal:data', { sessionId, terminalId, data })
      }
    })

    proc.onExit(({ exitCode }) => {
      entry.status = 'exited'
      this.emit('terminal:exit', { sessionId, terminalId, exitCode })
    })

    this.terminals.set(terminalId, entry)
    console.log(`[TERMINAL_DEBUG_BACKEND] terminal ready terminalId=${terminalId} cols=${cols} rows=${rows}`)
    this.emit('terminal:ready', { sessionId, terminalId })
  }

  sendToTerminal(terminalId: string, data: string): void {
    const entry = this.terminals.get(terminalId)
    if (entry?.status === 'running') {
      entry.pty.write(data)
    }
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    const entry = this.terminals.get(terminalId)
    if (entry?.status === 'running') {
      console.log(`[TERMINAL_DEBUG_BACKEND] resizeTerminal terminalId=${terminalId} cols=${cols} rows=${rows}`)
      entry.resizing = true
      entry.pty.resize(cols, rows)
      setImmediate(() => {
        entry.resizing = false
        const buffered = entry.resizeBuffer.splice(0)
        if (buffered.length > 0) {
          this.emit('terminal:data', { sessionId: entry.sessionId, terminalId, data: buffered.join('') })
        }
        this.emit('terminal:resized', { sessionId: entry.sessionId, terminalId })
      })
    } else {
      this.pendingResize.set(terminalId, { cols, rows })
    }
  }

  broadcastToAll(data: string, terminalIds?: string[]): void {
    const targets = terminalIds ?? Array.from(this.terminals.keys())
    for (const id of targets) this.sendToTerminal(id, data)
  }

  getBuffer(terminalId: string): string[] {
    return this.terminals.get(terminalId)?.buffer.slice() ?? []
  }

  killTerminal(terminalId: string): void {
    const entry = this.terminals.get(terminalId)
    if (entry) {
      if (entry.status === 'running') {
        entry.pty.kill()
        entry.status = 'exited'
      }
      this.terminals.delete(terminalId)
    }
    this.pendingResize.delete(terminalId)
  }

  hasTerminal(terminalId: string): boolean {
    return this.terminals.has(terminalId)
  }

  getTerminalIdsBySession(sessionId: string): string[] {
    const result: string[] = []
    for (const [terminalId, entry] of this.terminals) {
      if (entry.sessionId === sessionId) result.push(terminalId)
    }
    return result
  }

  private appendBuffer(entry: TerminalEntry, data: string): void {
    if (entry.buffer.length >= this.BUFFER_LIMIT) entry.buffer.shift()
    entry.buffer.push(data)
  }

}
