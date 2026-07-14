import type { AgentType } from '@akari/shared-types'
import type { ComponentType, CSSProperties } from 'react'
import { Bot, Code2, Terminal } from 'lucide-react'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { KimiIcon } from '@/components/icons/KimiIcon'

export interface AgentConfig {
  displayName: string
  icon: ComponentType<{ className?: string; style?: CSSProperties }>
  color: string
  supportsBypassPermissions: boolean
}

export const AGENT_CONFIG: Record<AgentType, AgentConfig> = {
  claude: {
    displayName: 'Claude Code',
    icon: ClaudeIcon,
    color: '#7c3aed',
    supportsBypassPermissions: true,
  },
  'claude-orchestrator': {
    displayName: 'Claude Orchestrator',
    icon: Bot,
    color: '#b45309',
    supportsBypassPermissions: true,
  },
  aider: {
    displayName: 'Aider',
    icon: Code2,
    color: '#2563eb',
    supportsBypassPermissions: false,
  },
  kimi: {
    displayName: 'Kimi',
    icon: KimiIcon,
    color: '#1783FF',
    supportsBypassPermissions: true,
  },
  shell: {
    displayName: 'Shell',
    icon: Terminal,
    color: '#374151',
    supportsBypassPermissions: false,
  },
}

export const AGENT_TYPES: AgentType[] = Object.keys(AGENT_CONFIG).filter((key): key is AgentType => key in AGENT_CONFIG)

export function getAgentConfig(agentType: AgentType): AgentConfig {
  return AGENT_CONFIG[agentType] ?? AGENT_CONFIG.shell
}
