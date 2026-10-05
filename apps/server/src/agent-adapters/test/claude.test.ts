import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ClaudeAdapter } from '../claude.js'

describe('ClaudeAdapter HTTP hook authentication', () => {
  const originalToken = process.env.AKARI_AUTH_TOKEN
  const originalPort = process.env.PORT

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.AKARI_AUTH_TOKEN
    } else {
      process.env.AKARI_AUTH_TOKEN = originalToken
    }
    if (originalPort === undefined) {
      delete process.env.PORT
    } else {
      process.env.PORT = originalPort
    }
  })

  it('injects the server token through an authorization header', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'akari-claude-hook-'))
    process.env.AKARI_AUTH_TOKEN = 'test-token'
    process.env.PORT = '3001'
    try {
      await new ClaudeAdapter().prepare(worktree, '', 'session-1')
      const content = await readFile(join(worktree, '.claude', 'settings.local.json'), 'utf8')
      const settings = JSON.parse(content)
      const hook = settings.hooks.PermissionRequest[0].hooks[0]
      expect(hook.headers).toEqual({ Authorization: 'Bearer $AKARI_AUTH_TOKEN' })
      expect(hook.allowedEnvVars).toEqual(['AKARI_AUTH_TOKEN'])
      expect(hook.url).toBe('http://127.0.0.1:3001/sessions/session-1/hooks')
      expect(hook.url).not.toContain('test-token')
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })
})
