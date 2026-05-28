import type { AgentAdapter, PtyCommand } from './base.js'

/**
 * Delay after the PTY shell starts before sending the claude launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
const SHELL_STARTUP_DELAY_MS = 800

/**
 * Build the Claude Code `--settings` JSON for in-memory hook injection.
 *
 * Format: each hook event maps to an array of "matcher groups".
 * Each matcher group has an optional `matcher` field and a required `hooks`
 * sub-array of handler objects. Omitting `matcher` means "match all".
 *
 * Reference: docs/claude code 的hook参考.md — Hook 处理程序字段
 */
function buildHooksSettings(sessionId: string): string {
  const port = process.env['PORT'] ?? '3001'
  const url = `http://localhost:${port}/sessions/${sessionId}/hooks`
  const handler = { type: 'http', url }
  const group = { hooks: [handler] }
  const settings = {
    hooks: {
      PermissionRequest: [group],
      SessionStart:      [group],
      Stop:              [group],
      StopFailure:       [group],
    },
  }
  return JSON.stringify(settings)
}

const ORCHESTRATOR_SYSTEM_PROMPT = [
  'You are an Akari Orchestrator Agent managing a multi-agent collaboration network.',
  'You coordinate parallel work by delegating tasks to worker agents via Akari MCP tools.',
  'Focus on breaking down complex tasks, delegating subtasks, and synthesizing results.',
  'Dangerous operations will be intercepted automatically for user approval.',
].join(' ')

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType = 'claude'

  async prepare(_worktreePath: string, _task: string, sessionId: string): Promise<PtyCommand[]> {
    let settings = buildHooksSettings(sessionId)
    if (process.platform === 'win32') {
      settings = settings.replace(/"/g, '\\"')
    }
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    return [{ cmd: `claude --settings '${settings}'${nl}` }]
  }
}

export class ClaudeOrchestratorAdapter implements AgentAdapter {
  readonly agentType = 'claude-orchestrator'

  async prepare(_worktreePath: string, _task: string, sessionId: string): Promise<PtyCommand[]> {
    let settings = buildHooksSettings(sessionId)
    if (process.platform === 'win32') {
      settings = settings.replace(/"/g, '\\"')
    }
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    const prompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(/"/g, '\\"')
    return [{ cmd: `claude --settings '${settings}' --append-system-prompt "${prompt}"${nl}` }]
  }
}

export { SHELL_STARTUP_DELAY_MS }
