import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentAdapter, PtyCommand } from './base.js'

/**
 * Delay after the PTY shell starts before sending the claude launch command.
 * Gives PowerShell / bash time to show its prompt.
 */
const SHELL_STARTUP_DELAY_MS = 800

const HOOK_URL = (sessionId: string): string => {
  const port = process.env['PORT'] ?? '3001'
  return `http://localhost:${port}/sessions/${sessionId}/hooks`
}

async function writeClaudeSettings(worktreePath: string, sessionId: string): Promise<void> {
  const hookUrl = HOOK_URL(sessionId)
  const settings = {
    hooks: {
      PermissionRequest: [{ type: 'http', url: hookUrl }],
      SessionStart: [{ type: 'http', url: hookUrl }],
      Stop: [{ type: 'http', url: hookUrl }],
      StopFailure: [{ type: 'http', url: hookUrl }],
    },
  }
  const claudeDir = join(worktreePath, '.claude')
  await mkdir(claudeDir, { recursive: true })
  await writeFile(join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2))
}

const ORCHESTRATOR_SYSTEM_PROMPT = [
  'You are an Akari Orchestrator Agent managing a multi-agent collaboration network.',
  'You coordinate parallel work by delegating tasks to worker agents via Akari MCP tools.',
  'Focus on breaking down complex tasks, delegating subtasks, and synthesizing results.',
  'Dangerous operations will be intercepted automatically for user approval.',
].join(' ')

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType = 'claude'

  async prepare(worktreePath: string, _task: string, sessionId: string): Promise<PtyCommand[]> {
    await writeClaudeSettings(worktreePath, sessionId)
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    return [{ cmd: `claude${nl}` }]
  }
}

export class ClaudeOrchestratorAdapter implements AgentAdapter {
  readonly agentType = 'claude-orchestrator'

  async prepare(worktreePath: string, _task: string, sessionId: string): Promise<PtyCommand[]> {
    await writeClaudeSettings(worktreePath, sessionId)
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    const prompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(/"/g, '\\"')
    return [{ cmd: `claude --append-system-prompt "${prompt}"${nl}` }]
  }
}

export { SHELL_STARTUP_DELAY_MS }
