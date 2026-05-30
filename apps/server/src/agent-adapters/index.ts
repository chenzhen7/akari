import type { AgentAdapter } from './base.js'
import { ClaudeAdapter, SHELL_STARTUP_DELAY_MS } from './claude.js'

export type { AgentAdapter, PtyCommand } from './base.js'
export { ClaudeAdapter, SHELL_STARTUP_DELAY_MS } from './claude.js'

/**
 * Returns the appropriate AgentAdapter for the given agent type, or `null`
 * if no automated launch is needed (e.g. plain shell — the user drives it).
 */
export function createAgentAdapter(agentType: string): AgentAdapter | null {
  switch (agentType) {
    case 'claude':
      return new ClaudeAdapter()
    case 'aider':
    case 'shell':
    case 'claude-orchestrator':
    default:
      return null
  }
}
