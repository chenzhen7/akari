export interface PtyCommand {
  cmd: string
  delayMs?: number
}

export interface AgentLaunchOptions {
  bypassPermissions?: boolean
}

/**
 * Delay after the PTY shell starts before sending an agent launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
export const SHELL_STARTUP_DELAY_MS = 800

export interface AgentAdapter {
  readonly agentType: string
  readonly displayName: string
  readonly requiresTty: boolean
  readonly stdinSubmitSequence: string
  readonly readyIndicatorPattern?: RegExp
  readonly supportsBypassPermissions: boolean
  readonly isAutomated: boolean

  getTabLabel(): string
  buildArgs?(opts: { task: string; worktreePath: string; bypassPermissions?: boolean }): string[]
  formatPrompt?(task: string): string

  /**
   * Called after the worktree is created and the PTY terminal is running.
   * Returns the sequence of commands to send to the PTY to launch the agent.
   *
   * Each command's `delayMs` specifies how long to wait **before** sending
   * that command (cumulative from the previous command in the sequence).
   * The first command is sent after a base startup delay managed by SessionManager.
   *
   * @param worktreePath Absolute path to the session's git worktree
   * @param task Task description to give to the agent
   * @param sessionId Session ID
   * @param options Optional launch options (e.g. bypass permissions)
   */
  prepare(worktreePath: string, task: string, sessionId: string, options?: AgentLaunchOptions): Promise<PtyCommand[]>
}

/**
 * Base adapter that provides a no-op prepare() returning an empty command
 * sequence. Useful for adapters that do not need to send any launch commands.
 */
export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly agentType: string
  abstract readonly displayName: string
  abstract readonly requiresTty: boolean
  abstract readonly stdinSubmitSequence: string
  readonly readyIndicatorPattern?: RegExp
  abstract readonly supportsBypassPermissions: boolean
  abstract readonly isAutomated: boolean

  abstract getTabLabel(): string
  buildArgs?(opts: { task: string; worktreePath: string; bypassPermissions?: boolean }): string[]
  formatPrompt?(task: string): string

  async prepare(): Promise<PtyCommand[]> {
    return []
  }
}
