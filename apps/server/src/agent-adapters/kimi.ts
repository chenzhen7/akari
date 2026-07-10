import type { AgentAdapter, AgentLaunchOptions, PtyCommand } from './base.js'

/**
 * Delay after the PTY shell starts before sending the kimi launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
const SHELL_STARTUP_DELAY_MS = 800

export class KimiAdapter implements AgentAdapter {
  readonly agentType = 'kimi'

  async prepare(_worktreePath: string, _task: string, _sessionId: string, options?: AgentLaunchOptions): Promise<PtyCommand[]> {
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    const yoloFlag = options?.bypassPermissions ? ' --yolo' : ''
    return [{ cmd: `kimi${yoloFlag}${nl}`, delayMs: SHELL_STARTUP_DELAY_MS }]
  }
}

export { SHELL_STARTUP_DELAY_MS }
