import type { SessionTab } from '@akari/shared-types'

/**
 * Type guard for tabs that host a PTY terminal.
 * Both generic terminal tabs and agent-backed tabs share the same runtime shape.
 */
export function isTerminalLikeTab(tab: SessionTab | undefined | null): tab is SessionTab & { type: 'terminal' | 'agent' } {
  return tab?.type === 'terminal' || tab?.type === 'agent'
}
