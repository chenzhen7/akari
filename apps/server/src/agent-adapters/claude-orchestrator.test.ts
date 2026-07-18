import { describe, it, expect } from 'vitest'
import { ClaudeOrchestratorAdapter } from './claude-orchestrator.js'
import { ClaudeAdapter } from './claude.js'

describe('ClaudeOrchestratorAdapter', () => {
  const adapter = new ClaudeOrchestratorAdapter()

  it('extends ClaudeAdapter', () => {
    expect(adapter).toBeInstanceOf(ClaudeAdapter)
  })

  it('overrides agentType', () => {
    expect(adapter.agentType).toBe('claude-orchestrator')
  })

  it('overrides displayName', () => {
    expect(adapter.displayName).toBe('Claude Orchestrator')
  })

  it('overrides getTabLabel', () => {
    expect(adapter.getTabLabel()).toBe('Claude Orchestrator')
  })

  it('inherits core capabilities from ClaudeAdapter', () => {
    expect(adapter.requiresTty).toBe(true)
    expect(adapter.stdinSubmitSequence).toBe('\r\n')
    expect(adapter.supportsBypassPermissions).toBe(true)
    expect(adapter.isAutomated).toBe(true)
  })

  it('buildArgs produces permission-mode bypass args', () => {
    expect(adapter.buildArgs?.({ bypassPermissions: true })).toEqual(['--permission-mode', 'bypassPermissions'])
    expect(adapter.buildArgs?.({})).toEqual([])
  })
})
