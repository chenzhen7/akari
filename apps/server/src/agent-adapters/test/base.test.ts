import { describe, it, expect } from 'vitest'
import { SHELL_STARTUP_DELAY_MS, BaseAgentAdapter } from '../base.js'

describe('SHELL_STARTUP_DELAY_MS', () => {
  it('is 800ms', () => {
    expect(SHELL_STARTUP_DELAY_MS).toBe(800)
  })
})

describe('BaseAgentAdapter', () => {
  class TestAdapter extends BaseAgentAdapter {
    readonly agentType = 'test'
    readonly displayName = 'Test Agent'
    readonly requiresTty = true
    readonly stdinSubmitSequence = '\n'
    readonly supportsBypassPermissions = false
    readonly isAutomated = true

    getTabLabel(): string {
      return 'Test'
    }
  }

  it('provides a no-op prepare() returning empty array', async () => {
    const adapter = new TestAdapter()
    const commands = await adapter.prepare('/worktree', 'task', 'session-id')
    expect(commands).toEqual([])
  })
})
