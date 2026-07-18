import { describe, it, expect } from 'vitest'
import { createAgentAdapter } from './index.js'
import { ClaudeAdapter } from './claude.js'
import { KimiAdapter } from './kimi.js'
import { ShellAdapter } from './shell.js'
import { AiderAdapter } from './aider.js'
import { ClaudeOrchestratorAdapter } from './claude-orchestrator.js'

describe('createAgentAdapter', () => {
  it('returns ClaudeAdapter for claude', () => {
    const adapter = createAgentAdapter('claude')
    expect(adapter).toBeInstanceOf(ClaudeAdapter)
    expect(adapter.agentType).toBe('claude')
  })

  it('returns ClaudeOrchestratorAdapter for claude-orchestrator', () => {
    const adapter = createAgentAdapter('claude-orchestrator')
    expect(adapter).toBeInstanceOf(ClaudeOrchestratorAdapter)
    expect(adapter.agentType).toBe('claude-orchestrator')
  })

  it('returns KimiAdapter for kimi', () => {
    const adapter = createAgentAdapter('kimi')
    expect(adapter).toBeInstanceOf(KimiAdapter)
    expect(adapter.agentType).toBe('kimi')
  })

  it('returns AiderAdapter for aider', () => {
    const adapter = createAgentAdapter('aider')
    expect(adapter).toBeInstanceOf(AiderAdapter)
    expect(adapter.agentType).toBe('aider')
  })

  it('returns ShellAdapter for shell', () => {
    const adapter = createAgentAdapter('shell')
    expect(adapter).toBeInstanceOf(ShellAdapter)
    expect(adapter.agentType).toBe('shell')
  })

  it('falls back to ShellAdapter for unknown types', () => {
    const adapter = createAgentAdapter('unknown-agent')
    expect(adapter).toBeInstanceOf(ShellAdapter)
    expect(adapter.agentType).toBe('shell')
  })
})
