export interface PtyCommand {
  cmd: string
  delayMs?: number
}

export interface AgentLaunchOptions {
  bypassPermissions?: boolean
}

export interface AgentAdapter {
  readonly agentType: string
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
