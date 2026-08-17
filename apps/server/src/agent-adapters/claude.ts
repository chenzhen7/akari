import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentAdapter, AgentLaunchOptions, PtyCommand } from './base.js'
import { SHELL_STARTUP_DELAY_MS } from './base.js'

const HOOK_URL = (sessionId: string): string => {
  const port = process.env['PORT'] ?? '3001'
  return `http://localhost:${port}/sessions/${sessionId}/hooks`
}

interface HttpHook {
  type: 'http'
  url: string
}

interface HookGroup {
  hooks: HttpHook[]
}

type HookEventName = 'PermissionRequest' | 'Stop'

interface ClaudeSettings {
  // 读取已有配置时允许任意事件名（旧版本注入的 SessionStart/UserPromptSubmit/StopFailure 需清理）
  hooks?: Record<string, HookGroup[]>
  allowedHttpHookUrls?: string[]
}

function isClaudeSettings(value: unknown): value is ClaudeSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHookGroup(value: unknown): value is HookGroup {
  return typeof value === 'object' && value !== null && Array.isArray((value as HookGroup).hooks)
}

async function writeClaudeSettings(worktreePath: string, sessionId: string): Promise<void> {
  const hookUrl = HOOK_URL(sessionId)
  const claudeDir = join(worktreePath, '.claude')
  const settingsPath = join(claudeDir, 'settings.local.json')

  let existingSettings: ClaudeSettings = {}
  try {
    const content = await readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(content)
    if (isClaudeSettings(parsed)) {
      existingSettings = parsed
    }
  } catch {
    // 若文件不存在或内容非法，默认为空对象
  }

  const hookEvents: HookEventName[] = ['PermissionRequest', 'Stop']

  // 先从已有配置中剔除指向本服务的 hook（含已废弃事件上的残留），再按当前事件列表重新注入，
  // 保证幂等且不遗留旧事件
  const hooks: Record<string, HookGroup[]> = {}
  for (const [eventName, groups] of Object.entries(existingSettings.hooks ?? {})) {
    if (!Array.isArray(groups)) continue
    const cleaned = groups
      .filter(isHookGroup)
      .map(group => ({
        ...group,
        hooks: group.hooks.filter(h => !(h.type === 'http' && h.url === hookUrl)),
      }))
      .filter(group => group.hooks.length > 0)
    if (cleaned.length > 0) {
      hooks[eventName] = cleaned
    }
  }
  for (const event of hookEvents) {
    hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'http', url: hookUrl }] }]
  }

  existingSettings.hooks = hooks

  // 允许 HTTP hook 回调到 Akari 后端，否则 Claude Code 会静默阻止本地 HTTP hooks
  const allowedHttpHookUrls = Array.isArray(existingSettings.allowedHttpHookUrls)
    ? existingSettings.allowedHttpHookUrls.filter((url): url is string => typeof url === 'string')
    : []
  const allowedUrlPattern = `http://localhost:${process.env['PORT'] ?? '3001'}/*`
  if (!allowedHttpHookUrls.includes(allowedUrlPattern)) {
    allowedHttpHookUrls.push(allowedUrlPattern)
  }
  existingSettings.allowedHttpHookUrls = allowedHttpHookUrls

  await mkdir(claudeDir, { recursive: true })
  await writeFile(settingsPath, JSON.stringify(existingSettings, null, 2))
}

export class ClaudeAdapter implements AgentAdapter {
  readonly agentType: string = 'claude'
  readonly displayName: string = 'Claude Code'
  readonly requiresTty = true
  readonly stdinSubmitSequence = '\r\n'
  readonly supportsBypassPermissions = true
  readonly isAutomated = true

  getTabLabel(): string {
    return 'Claude'
  }

  buildArgs(opts: { bypassPermissions?: boolean }): string[] {
    const args: string[] = []
    if (opts.bypassPermissions) {
      args.push('--permission-mode', 'bypassPermissions')
    }
    return args
  }

  async prepare(worktreePath: string, _task: string, sessionId: string, options?: AgentLaunchOptions): Promise<PtyCommand[]> {
    await writeClaudeSettings(worktreePath, sessionId)
    const nl = process.platform === 'win32' ? '\r\n' : '\n'
    const argString = this.buildArgs(options ?? {}).join(' ')
    return [{ cmd: `claude${argString ? ` ${argString}` : ''}${nl}` }]
  }
}
