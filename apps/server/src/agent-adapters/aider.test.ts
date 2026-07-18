import { describe, it, expect } from 'vitest'
import { AiderAdapter } from './aider.js'

describe('AiderAdapter', () => {
  const adapter = new AiderAdapter()

  it('has correct metadata', () => {
    expect(adapter.agentType).toBe('aider')
    expect(adapter.displayName).toBe('Aider')
    expect(adapter.requiresTty).toBe(true)
    expect(adapter.stdinSubmitSequence).toBe('\r\n')
    expect(adapter.supportsBypassPermissions).toBe(false)
    expect(adapter.isAutomated).toBe(false)
  })

  it('returns Aider tab label', () => {
    expect(adapter.getTabLabel()).toBe('Aider')
  })

  it('prepare returns empty command sequence', async () => {
    const commands = await adapter.prepare('/worktree', 'task', 'session-id')
    expect(commands).toEqual([])
  })
})
