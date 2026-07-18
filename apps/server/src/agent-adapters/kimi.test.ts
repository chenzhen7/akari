import { describe, it, expect, vi } from 'vitest'
import { KimiAdapter } from './kimi.js'
import { SHELL_STARTUP_DELAY_MS } from './base.js'

describe('KimiAdapter', () => {
  const adapter = new KimiAdapter()

  it('has correct metadata', () => {
    expect(adapter.agentType).toBe('kimi')
    expect(adapter.displayName).toBe('Kimi')
    expect(adapter.requiresTty).toBe(true)
    expect(adapter.stdinSubmitSequence).toBe('\r\n')
    expect(adapter.supportsBypassPermissions).toBe(true)
    expect(adapter.isAutomated).toBe(true)
  })

  it('returns Kimi tab label', () => {
    expect(adapter.getTabLabel()).toBe('Kimi')
  })

  describe('buildArgs', () => {
    it('includes --yolo when bypassPermissions is true', () => {
      expect(adapter.buildArgs({ bypassPermissions: true })).toEqual(['--yolo'])
    })

    it('returns empty args when bypassPermissions is false', () => {
      expect(adapter.buildArgs({ bypassPermissions: false })).toEqual([])
    })

    it('returns empty args when no options provided', () => {
      expect(adapter.buildArgs({})).toEqual([])
    })
  })

  describe('prepare', () => {
    it('sends kimi command with startup delay on Unix', async () => {
      vi.stubGlobal('process', { ...process, platform: 'linux' })
      const commands = await adapter.prepare('/worktree', 'task', 'session-id')
      expect(commands).toEqual([{ cmd: 'kimi\n', delayMs: SHELL_STARTUP_DELAY_MS }])
      vi.unstubAllGlobals()
    })

    it('sends kimi command with CRLF on Windows', async () => {
      vi.stubGlobal('process', { ...process, platform: 'win32' })
      const commands = await adapter.prepare('/worktree', 'task', 'session-id')
      expect(commands).toEqual([{ cmd: 'kimi\r\n', delayMs: SHELL_STARTUP_DELAY_MS }])
      vi.unstubAllGlobals()
    })

    it('appends bypass arg when requested', async () => {
      vi.stubGlobal('process', { ...process, platform: 'linux' })
      const commands = await adapter.prepare('/worktree', 'task', 'session-id', { bypassPermissions: true })
      expect(commands).toEqual([{ cmd: 'kimi --yolo\n', delayMs: SHELL_STARTUP_DELAY_MS }])
      vi.unstubAllGlobals()
    })
  })
})
