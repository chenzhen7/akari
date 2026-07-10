import type { AgentAdapter } from './base.js'
import { ClaudeAdapter, SHELL_STARTUP_DELAY_MS as CLAUDE_SHELL_STARTUP_DELAY_MS } from './claude.js'
import { KimiAdapter, SHELL_STARTUP_DELAY_MS as KIMI_SHELL_STARTUP_DELAY_MS } from './kimi.js'

export type { AgentAdapter, PtyCommand, AgentLaunchOptions } from './base.js'
export { ClaudeAdapter } from './claude.js'
export { KimiAdapter } from './kimi.js'

/**
 * Returns the appropriate AgentAdapter for the given agent type, or `null`
 * if no automated launch is needed (e.g. plain shell — the user drives it).
 */
export function createAgentAdapter(agentType: string): AgentAdapter | null {
  switch (agentType) {
    case 'claude':
      return new ClaudeAdapter()
    case 'kimi':
      return new KimiAdapter()
    case 'aider':
    case 'shell':
    case 'claude-orchestrator':
    default:
      return null
  }
}

export const SHELL_STARTUP_DELAY_MS = Math.max(CLAUDE_SHELL_STARTUP_DELAY_MS, KIMI_SHELL_STARTUP_DELAY_MS)
