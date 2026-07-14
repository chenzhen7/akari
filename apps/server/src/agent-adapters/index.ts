import type { AgentAdapter } from './base.js'
import { SHELL_STARTUP_DELAY_MS } from './base.js'
import { ClaudeAdapter } from './claude.js'
import { KimiAdapter } from './kimi.js'
import { ShellAdapter } from './shell.js'
import { AiderAdapter } from './aider.js'
import { ClaudeOrchestratorAdapter } from './claude-orchestrator.js'

export type { AgentAdapter, PtyCommand, AgentLaunchOptions } from './base.js'
export { ClaudeAdapter } from './claude.js'
export { KimiAdapter } from './kimi.js'
export { ShellAdapter } from './shell.js'
export { AiderAdapter } from './aider.js'
export { ClaudeOrchestratorAdapter } from './claude-orchestrator.js'

/**
 * Returns the appropriate AgentAdapter for the given agent type.
 * Unknown types fall back to ShellAdapter so callers can always read metadata.
 */
export function createAgentAdapter(agentType: string): AgentAdapter {
  switch (agentType) {
    case 'claude':
      return new ClaudeAdapter()
    case 'claude-orchestrator':
      return new ClaudeOrchestratorAdapter()
    case 'kimi':
      return new KimiAdapter()
    case 'aider':
      return new AiderAdapter()
    case 'shell':
    default:
      return new ShellAdapter()
  }
}

export { SHELL_STARTUP_DELAY_MS } from './base.js'
