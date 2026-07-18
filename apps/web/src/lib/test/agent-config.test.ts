import { describe, it, expect } from 'vitest'
import { AGENT_CONFIG, AGENT_TYPES, getAgentConfig } from '../agent-config'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { KimiIcon } from '@/components/icons/KimiIcon'
import { Bot, Code2, Terminal } from 'lucide-react'

describe('AGENT_CONFIG', () => {
  it('contains all supported agent types', () => {
    expect(Object.keys(AGENT_CONFIG).sort()).toEqual(['aider', 'claude', 'claude-orchestrator', 'kimi', 'shell'])
  })

  it('maps correct metadata for claude', () => {
    const cfg = AGENT_CONFIG.claude
    expect(cfg.displayName).toBe('Claude Code')
    expect(cfg.icon).toBe(ClaudeIcon)
    expect(cfg.color).toBe('#7c3aed')
    expect(cfg.supportsBypassPermissions).toBe(true)
  })

  it('maps correct metadata for kimi', () => {
    const cfg = AGENT_CONFIG.kimi
    expect(cfg.displayName).toBe('Kimi')
    expect(cfg.icon).toBe(KimiIcon)
    expect(cfg.supportsBypassPermissions).toBe(true)
  })

  it('maps correct metadata for aider', () => {
    const cfg = AGENT_CONFIG.aider
    expect(cfg.displayName).toBe('Aider')
    expect(cfg.icon).toBe(Code2)
    expect(cfg.supportsBypassPermissions).toBe(false)
  })

  it('maps correct metadata for shell', () => {
    const cfg = AGENT_CONFIG.shell
    expect(cfg.displayName).toBe('Shell')
    expect(cfg.icon).toBe(Terminal)
    expect(cfg.supportsBypassPermissions).toBe(false)
  })

  it('maps correct metadata for orchestrator', () => {
    const cfg = AGENT_CONFIG['claude-orchestrator']
    expect(cfg.displayName).toBe('Claude Orchestrator')
    expect(cfg.icon).toBe(Bot)
    expect(cfg.supportsBypassPermissions).toBe(true)
  })
})

describe('AGENT_TYPES', () => {
  it('lists all agent types', () => {
    expect(AGENT_TYPES.sort()).toEqual(['aider', 'claude', 'claude-orchestrator', 'kimi', 'shell'])
  })
})

describe('getAgentConfig', () => {
  it('returns config for valid agent type', () => {
    expect(getAgentConfig('kimi').displayName).toBe('Kimi')
  })

  it('falls back to shell for unknown agent type', () => {
    expect(getAgentConfig('unknown' as unknown as Parameters<typeof getAgentConfig>[0]).displayName).toBe('Shell')
  })
})
