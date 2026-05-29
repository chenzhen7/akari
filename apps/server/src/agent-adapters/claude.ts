import { mkdir, writeFile, readFile } from 'node:fs/promises'
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
  const claudeDir = join(worktreePath, '.claude')
  const settingsPath = join(claudeDir, 'settings.local.json')

  let existingSettings: any = {}
  try {
    const content = await readFile(settingsPath, 'utf8')
    existingSettings = JSON.parse(content)
  } catch {
    // 若文件不存在或内容非法，默认为空对象
    existingSettings = {}
  }

  // 确保 hooks 对象存在
  if (!existingSettings.hooks || typeof existingSettings.hooks !== 'object') {
    existingSettings.hooks = {}
  }

  const hookEvents = ['PermissionRequest', 'SessionStart', 'Stop', 'StopFailure'] as const

  for (const event of hookEvents) {
    if (!Array.isArray(existingSettings.hooks[event])) {
      existingSettings.hooks[event] = []
    }

    const eventHooksArray = existingSettings.hooks[event] as any[]

    // 检查我们的 hookUrl 是否已存在，避免重复添加
    let alreadyExists = false
    for (const item of eventHooksArray) {
      if (item && Array.isArray(item.hooks)) {
        for (const h of item.hooks) {
          if (h && h.type === 'http' && h.url === hookUrl) {
            alreadyExists = true
            break
          }
        }
      }
      if (alreadyExists) break
    }

    if (!alreadyExists) {
      eventHooksArray.push({
        hooks: [{ type: 'http', url: hookUrl }],
      })
    }
  }

  await mkdir(claudeDir, { recursive: true })
  await writeFile(settingsPath, JSON.stringify(existingSettings, null, 2))
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
