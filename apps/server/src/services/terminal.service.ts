import type { TerminalMultiplexer } from '../infrastructure/pty/terminal-multiplexer.js'

export interface ITerminalService {
  createTerminal(terminalId: string, sessionId: string, cwd: string): void
  sendToTerminal(terminalId: string, data: string): void
  resizeTerminal(terminalId: string, cols: number, rows: number): void
  getBuffer(terminalId: string): string[]
  killTerminal(terminalId: string): void
  hasTerminal(terminalId: string): boolean
  getTerminalIdsBySession(sessionId: string): string[]
  dispose(): void
}

export class TerminalService implements ITerminalService {
  constructor(private readonly mux: TerminalMultiplexer) {}

  createTerminal(terminalId: string, sessionId: string, cwd: string): void {
    this.mux.createTerminal(terminalId, sessionId, cwd)
  }

  sendToTerminal(terminalId: string, data: string): void {
    this.mux.sendToTerminal(terminalId, data)
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    this.mux.resizeTerminal(terminalId, cols, rows)
  }

  getBuffer(terminalId: string): string[] {
    return this.mux.getBuffer(terminalId)
  }

  killTerminal(terminalId: string): void {
    this.mux.killTerminal(terminalId)
  }

  hasTerminal(terminalId: string): boolean {
    return this.mux.hasTerminal(terminalId)
  }

  getTerminalIdsBySession(sessionId: string): string[] {
    return this.mux.getTerminalIdsBySession(sessionId)
  }

  dispose(): void {
    this.mux.dispose()
  }
}
