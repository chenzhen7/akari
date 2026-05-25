import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import type { ApprovalRequest } from '@akari/shared-types'

interface TerminalEntry {
  sessionId: string
  pty: pty.IPty
  buffer: string[]
  status: 'running' | 'exited'
}

export class TerminalMultiplexer extends EventEmitter {
  private readonly terminals = new Map<string, TerminalEntry>()
  private readonly pendingResize = new Map<string, { cols: number; rows: number }>()
  private readonly BUFFER_LIMIT = 5000
  /** Index into entry.buffer where the current animation frame starts (-1 = not in animation) */
  private readonly frameStart = new Map<string, number>()

  createTerminal(sessionId: string, cwd: string): void {
    if (this.terminals.has(sessionId)) return

    const isWindows = process.platform === 'win32'
    // Prefer PowerShell 7+ (pwsh.exe); fall back to built-in Windows PowerShell 5.x
    const hasPwsh = existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    const shell = isWindows
      ? (hasPwsh ? 'pwsh.exe' : 'powershell.exe')
      : (process.env.SHELL ?? 'bash')
    const args = isWindows ? ['-NoLogo'] : ['--login']

    const pending = this.pendingResize.get(sessionId)
    const cols = pending?.cols ?? 80
    const rows = pending?.rows ?? 24
    this.pendingResize.delete(sessionId)

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

    const entry: TerminalEntry = { sessionId, pty: proc, buffer: [], status: 'running' }

    proc.onData((data: string) => {
      this.appendBuffer(entry, data)
      this.emit('terminal:data', { sessionId, data })
      this.detectMarkers(sessionId, data)
    })

    proc.onExit(({ exitCode }) => {
      entry.status = 'exited'
      this.emit('terminal:exit', { sessionId, exitCode })
    })

    this.terminals.set(sessionId, entry)
    this.emit('terminal:ready', { sessionId })
  }

  sendToTerminal(sessionId: string, data: string): void {
    const entry = this.terminals.get(sessionId)
    if (entry?.status === 'running') {
      entry.pty.write(data)
    }
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    const entry = this.terminals.get(sessionId)
    if (entry?.status === 'running') {
      entry.pty.resize(cols, rows)
    } else {
      this.pendingResize.set(sessionId, { cols, rows })
    }
  }

  broadcastToAll(data: string, sessionIds?: string[]): void {
    const targets = sessionIds ?? Array.from(this.terminals.keys())
    for (const id of targets) this.sendToTerminal(id, data)
  }

  getBuffer(sessionId: string): string[] {
    return this.terminals.get(sessionId)?.buffer.slice() ?? []
  }

  killTerminal(sessionId: string): void {
    const entry = this.terminals.get(sessionId)
    if (entry) {
      if (entry.status === 'running') {
        entry.pty.kill()
        entry.status = 'exited'
      }
      this.terminals.delete(sessionId)
    }
    this.pendingResize.delete(sessionId)
    this.frameStart.delete(sessionId)
  }

  hasTerminal(sessionId: string): boolean {
    return this.terminals.has(sessionId)
  }

  private appendBuffer(entry: TerminalEntry, data: string): void {
    if (data.includes('\x1b[H')) {
      // Cursor-home = start of a new full-screen animation frame.
      // Truncate the previous frame (and its continuation chunks) so only the latest frame survives.
      const prev = this.frameStart.get(entry.sessionId) ?? -1
      if (prev >= 0 && prev < entry.buffer.length) {
        entry.buffer.splice(prev)
      }
      this.frameStart.set(entry.sessionId, entry.buffer.length)
    } else {
      // Linear content (response text, prompts) — reset animation frame tracking
      this.frameStart.set(entry.sessionId, -1)
    }
    if (entry.buffer.length >= this.BUFFER_LIMIT) entry.buffer.shift()
    entry.buffer.push(data)
  }

  private detectMarkers(sessionId: string, data: string): void {
    const approvalMatch = data.match(/\[APPROVAL_REQUIRED\] (.+)/)
    if (approvalMatch) {
      const raw = approvalMatch[1]
      const type = raw.match(/type=(\S+)/)?.[1] ?? 'destructive-op'
      const command = raw.match(/command="([^"]+)"/)?.[1]
      const request: ApprovalRequest = {
        type: type as ApprovalRequest['type'],
        message: raw,
        command,
        timestamp: new Date(),
      }
      this.emit('approval:required', { sessionId, request })
    }

    const checkpointMatch = data.match(/\[CHECKPOINT\] (.+)/)
    if (checkpointMatch) {
      this.emit('checkpoint:reached', { sessionId, description: checkpointMatch[1].trim() })
    }
  }
}
