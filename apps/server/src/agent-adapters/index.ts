import type { AgentAdapter } from './base.js'
import { ClaudeAdapter, ClaudeOrchestratorAdapter, SHELL_STARTUP_DELAY_MS } from './claude.js'

export type { AgentAdapter, PtyCommand } from './base.js'
export { ClaudeAdapter, ClaudeOrchestratorAdapter, SHELL_STARTUP_DELAY_MS } from './claude.js'

/**
 * Returns the appropriate AgentAdapter for the given agent type, or `null`
 * if no automated launch is needed (e.g. plain shell — the user drives it).
 */
export function createAgentAdapter(agentType: string): AgentAdapter | null {
  switch (agentType) {
    case 'claude':
      return new ClaudeAdapter()
    case 'claude-orchestrator':
      return new ClaudeOrchestratorAdapter()
    case 'aider':
    case 'shell':
    default:
      return null
  }
}
