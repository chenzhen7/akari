import { BaseAgentAdapter } from './base.js'

export class ShellAdapter extends BaseAgentAdapter {
  readonly agentType = 'shell'
  readonly displayName = 'Shell'
  readonly requiresTty = true
  readonly stdinSubmitSequence = '\r\n'
  readonly supportsBypassPermissions = false
  readonly isAutomated = false

  getTabLabel(): string {
    return 'Shell'
  }
}
