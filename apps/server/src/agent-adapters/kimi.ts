import type { AgentAdapter, AgentLaunchOptions, PtyCommand } from './base.js'
import { SHELL_STARTUP_DELAY_MS } from './base.js'

export class KimiAdapter implements AgentAdapter {
  readonly agentType = 'kimi'
  readonly displayName = 'Kimi'
  readonly requiresTty = true
  readonly stdinSubmitSequence = '\r\n'
  readonly supportsBypassPermissions = true
  readonly isAutomated = true

  getTabLabel(): string {
    return 'Kimi'
  }

  buildArgs(opts: { bypassPermissions?: boolean }): string[] {
    const args: string[] = []
    if (opts.bypassPermissions) {
      args.push('--yolo')
    }
    return args
  }

  async prepare(_worktreePath: string, _task: string, _sessionId: string, options?: AgentLaunchOptions): Promise<PtyCommand[]> {
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    const argString = this.buildArgs(options ?? {}).join(' ')
    return [{ cmd: `kimi${argString ? ` ${argString}` : ''}${nl}`, delayMs: SHELL_STARTUP_DELAY_MS }]
  }
}
