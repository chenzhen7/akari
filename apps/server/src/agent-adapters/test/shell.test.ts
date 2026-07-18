import { describe, it, expect } from 'vitest'
import { ShellAdapter } from '../shell.js'

describe('ShellAdapter', () => {
  const adapter = new ShellAdapter()

  it('has correct metadata', () => {
    expect(adapter.agentType).toBe('shell')
    expect(adapter.displayName).toBe('Shell')
    expect(adapter.requiresTty).toBe(true)
    expect(adapter.stdinSubmitSequence).toBe('\r\n')
    expect(adapter.supportsBypassPermissions).toBe(false)
    expect(adapter.isAutomated).toBe(false)
  })

  it('returns Shell tab label', () => {
    expect(adapter.getTabLabel()).toBe('Shell')
  })

  it('prepare returns empty command sequence', async () => {
    const commands = await adapter.prepare('/worktree', 'task', 'session-id')
    expect(commands).toEqual([])
  })
})
