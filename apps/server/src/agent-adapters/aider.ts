import { BaseAgentAdapter } from './base.js'

export class AiderAdapter extends BaseAgentAdapter {
  readonly agentType = 'aider'
  readonly displayName = 'Aider'
  readonly requiresTty = true
  readonly stdinSubmitSequence = '\r\n'
  readonly supportsBypassPermissions = false
  readonly isAutomated = false

  getTabLabel(): string {
    return 'Aider'
  }
}
