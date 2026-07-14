import { ClaudeAdapter } from './claude.js'

export class ClaudeOrchestratorAdapter extends ClaudeAdapter {
  readonly agentType = 'claude-orchestrator'
  readonly displayName = 'Claude Orchestrator'

  override getTabLabel(): string {
    return 'Claude Orchestrator'
  }
}
