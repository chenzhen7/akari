import type { AgentType } from '@akari/shared-types'
import { createAgentAdapter, SHELL_STARTUP_DELAY_MS } from '../agent-adapters/index.js'
import type { AgentLaunchOptions } from '../agent-adapters/index.js'
import type { ITerminalService } from './terminal.service.js'

/**
 * Sends the launch command sequence for an automated agent to a PTY terminal.
 * Non-automated adapters (e.g. plain shell) are no-ops.
 */
export async function launchAgentInTerminal(
  terminalService: ITerminalService,
  terminalId: string,
  worktreePath: string,
  agentType: AgentType,
  task: string,
  sessionId: string,
  launchOptions?: AgentLaunchOptions,
): Promise<void> {
  const adapter = createAgentAdapter(agentType)
  if (!adapter.isAutomated) return

  terminalService.sendToTerminal(terminalId, `> Launching ${agentType}...\r\n`)

  const commands = await adapter.prepare(worktreePath, task, sessionId, launchOptions)
  let cumulativeDelay = SHELL_STARTUP_DELAY_MS
  for (const { cmd, delayMs = 0 } of commands) {
    cumulativeDelay += delayMs
    setTimeout(() => {
      if (terminalService.hasTerminal(terminalId)) {
        terminalService.sendToTerminal(terminalId, cmd)
      }
    }, cumulativeDelay)
  }
}
