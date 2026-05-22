import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ApprovalRequest } from '@akari/shared-types'

interface TerminalEntry {
  sessionId: string
  proc: ChildProcess
  buffer: string[]
  status: 'running' | 'exited'
}

export class TerminalMultiplexer extends EventEmitter {
  private readonly terminals = new Map<string, TerminalEntry>()
  private readonly BUFFER_LIMIT = 5000

  createTerminal(sessionId: string, cwd: string): void {
    if (this.terminals.has(sessionId)) return

    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'cmd.exe' : (process.env.SHELL ?? 'bash')
    const args = isWindows ? [] : ['--login']

    const proc = spawn(shell, args, {
      cwd,
      env: { ...process.env, AGENT_SESSION_ID: sessionId },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const entry: TerminalEntry = { sessionId, proc, buffer: [], status: 'running' }

    proc.stdout?.on('data', (chunk: Buffer) => {
      const data = chunk.toString()
      this.appendBuffer(entry, data)
      this.emit('terminal:data', { sessionId, data })
      this.detectMarkers(sessionId, data)
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const data = chunk.toString()
      this.appendBuffer(entry, data)
      this.emit('terminal:data', { sessionId, data })
    })

    proc.on('exit', (code) => {
      entry.status = 'exited'
      this.emit('terminal:exit', { sessionId, exitCode: code ?? 0 })
    })

    proc.on('error', (err) => {
      this.emit('terminal:error', { sessionId, error: err.message })
    })

    this.terminals.set(sessionId, entry)
  }

  sendToTerminal(sessionId: string, data: string): void {
    const entry = this.terminals.get(sessionId)
    if (entry?.status === 'running' && entry.proc.stdin && !entry.proc.stdin.destroyed) {
      entry.proc.stdin.write(data)
    }
  }

  broadcastToAll(data: string, sessionIds?: string[]): void {
    const targets = sessionIds ?? Array.from(this.terminals.keys())
    for (const id of targets) this.sendToTerminal(id, data)
  }

  getBuffer(sessionId: string, lastN = 100): string[] {
    return this.terminals.get(sessionId)?.buffer.slice(-lastN) ?? []
  }

  killTerminal(sessionId: string): void {
    const entry = this.terminals.get(sessionId)
    if (entry) {
      if (entry.status === 'running') {
        entry.proc.kill('SIGTERM')
        entry.status = 'exited'
      }
      this.terminals.delete(sessionId)
    }
  }

  hasTerminal(sessionId: string): boolean {
    return this.terminals.has(sessionId)
  }

  private appendBuffer(entry: TerminalEntry, data: string): void {
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
