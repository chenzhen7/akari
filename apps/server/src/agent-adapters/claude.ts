import type { AgentAdapter, PtyCommand } from './base.js'

/**
 * Akari runtime instructions injected into Claude Code via --append-system-prompt.
 *
 * Constraints on this string:
 *  - No double-quotes (safe to wrap in "..." for PowerShell & bash)
 *  - No backticks or $ (safe in PowerShell double-quoted strings)
 *  - Single line (no literal newlines in the CLI arg)
 *
 * Claude Code reads this as extra system-prompt text appended to its default prompt.
 */
const AKARI_SYSTEM_PROMPT =
  'You are a coding agent running inside the Akari parallel development platform. ' +
  'Follow these output protocols strictly: ' +
  '(1) CHECKPOINT: After completing each significant step or milestone, output on its own line: ' +
  '[CHECKPOINT] brief description of what was accomplished. ' +
  '(2) APPROVAL REQUIRED: Before executing any destructive operation ' +
  '(deleting files, overwriting data, force-pushing to a remote branch, running irreversible commands), ' +
  'output on its own line: [APPROVAL_REQUIRED] type=destructive-op command=the_exact_command ' +
  'then STOP and wait for user input. If the user responds y then proceed; if n then skip the operation. ' +
  '(3) MERGE READY: When all work is complete and ready for code review and merging, output: ' +
  '[APPROVAL_REQUIRED] type=merge-ready ' +
  'then STOP and wait for the user to approve the merge.'

/**
 * Delay after the PTY shell starts before sending the claude launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
const SHELL_STARTUP_DELAY_MS = 800

/**
 * Delay after launching `claude` before injecting the task as the first message.
 * Gives Claude Code time to display its startup UI and become ready for input.
 */
const CLAUDE_STARTUP_DELAY_MS = 2500

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType = 'claude'

  async prepare(_worktreePath: string, task: string, _sessionId: string): Promise<PtyCommand[]> {
    const nl = process.platform === 'win32' ? '\r\n' : '\n'

    // Sanitize task: collapse newlines to spaces so the first Enter submits the full message
    const safeTask = task.replace(/\r?\n/g, ' ').trim()

    return [
      {
        // Start Claude Code in interactive mode with the Akari system prompt appended.
        // No delayMs here — SessionManager applies SHELL_STARTUP_DELAY_MS as the base delay.
        cmd: `claude --append-system-prompt "${AKARI_SYSTEM_PROMPT}"${nl}`,
      },
      {
        // Inject the task as the first user message once Claude is ready.
        cmd: `${safeTask}${nl}`,
        delayMs: CLAUDE_STARTUP_DELAY_MS,
      },
    ]
  }
}

export { SHELL_STARTUP_DELAY_MS }
