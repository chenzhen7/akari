import type { AgentAdapter, PtyCommand } from './base.js'

/**
 * Delay after the PTY shell starts before sending the claude launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
const SHELL_STARTUP_DELAY_MS = 800

const ORCHESTRATOR_SYSTEM_PROMPT = [
  'You are an Akari Orchestrator Agent managing a multi-agent collaboration network.',
  'You can use the following terminal output markers to coordinate work:',
  '',
  '[SPAWN_AGENT] task="<task>" agentType="claude"',
  '  -> Creates a new worker agent session for the given task.',
  '',
  '[DELEGATE] sessionId="<id>" message="<message>"',
  '  -> Sends a message to another agent terminal.',
  '',
  '[AWAIT_SESSION] sessionId="<id>" timeoutSeconds=300',
  '  -> Waits for another agent to complete and receive their result.',
  '',
  '[TASK_DONE] summary="<summary>"',
  '  -> Marks your task complete and passes a summary to downstream agents.',
  '',
  'Rules: dangerous operations still require [APPROVAL_REQUIRED]. Use [CHECKPOINT] to report progress.',
].join(' ')

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType = 'claude'

  async prepare(_worktreePath: string, _task: string, _sessionId: string): Promise<PtyCommand[]> {
    const nl = process.platform === 'win32' ? '\r\n' : '\n'

    return [
      {
        cmd: `claude${nl}`,
      },
    ]
  }
}

export class ClaudeOrchestratorAdapter implements AgentAdapter {
  readonly agentType = 'claude-orchestrator'

  async prepare(_worktreePath: string, _task: string, _sessionId: string): Promise<PtyCommand[]> {
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    const prompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(/"/g, '\\"')

    return [
      {
        cmd: `claude --append-system-prompt "${prompt}"${nl}`,
      },
    ]
  }
}

export { SHELL_STARTUP_DELAY_MS }
