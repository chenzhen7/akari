import type { AgentAdapter, PtyCommand } from './base.js'

/**
 * Delay after the PTY shell starts before sending the claude launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
const SHELL_STARTUP_DELAY_MS = 800

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType = 'claude'

  async prepare(_worktreePath: string, _task: string, _sessionId: string): Promise<PtyCommand[]> {
    const nl = process.platform === 'win32' ? '\r\n' : '\n'

    return [
      {
        // Start Claude Code in interactive mode, no extra prompt injection.
        cmd: `claude${nl}`,
      },
    ]
  }
}

export { SHELL_STARTUP_DELAY_MS }
