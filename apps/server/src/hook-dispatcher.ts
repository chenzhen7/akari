import type {
  ApprovalRequest,
  HookEvent,
  HookResponse,
  PermissionRequestPayload,
  StopFailurePayload,
} from '@akari/shared-types'
import type { SessionManager } from './session-manager.js'

export class ApprovalRegistry {
  private readonly pending = new Map<string, {
    resolve: (decision: 'approve' | 'deny') => void
    reject: (err: unknown) => void
  }>()

  async waitForApproval(sessionId: string): Promise<'approve' | 'deny'> {
    return new Promise((resolve, reject) => {
      this.pending.set(sessionId, { resolve, reject })
    })
  }

  resolveApproval(sessionId: string, decision: 'approved' | 'rejected'): boolean {
    const entry = this.pending.get(sessionId)
    if (!entry) return false
    entry.resolve(decision === 'approved' ? 'approve' : 'deny')
    this.pending.delete(sessionId)
    return true
  }

  dismissApproval(sessionId: string): boolean {
    const entry = this.pending.get(sessionId)
    if (!entry) return false
    entry.reject(new Error('dismissed'))
    this.pending.delete(sessionId)
    return true
  }

  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  rejectAll(reason: string): void {
    for (const [, entry] of this.pending) {
      entry.reject(new Error(reason))
    }
    this.pending.clear()
  }
}

export const approvalRegistry = new ApprovalRegistry()

export async function dispatchHookEvent(
  sessionId: string,
  event: HookEvent,
  sessionManager: SessionManager,
): Promise<HookResponse> {
  switch (event.hook_event_name) {
    case 'SessionStart': {
      const session = sessionManager.getSession(sessionId)
      if (session && session.status === 'initializing') {
        sessionManager.updateStatus(sessionId, 'running')
      }
      return {}
    }

    case 'PermissionRequest': {
      const { tool_name, tool_input } = event as PermissionRequestPayload
      const command = typeof tool_input?.['command'] === 'string' ? tool_input['command'] : undefined
      const description = typeof tool_input?.['description'] === 'string' ? tool_input['description'] : undefined
      const request: ApprovalRequest = {
        type: 'destructive-op',
        message: `PermissionRequest: ${tool_name}${command ? ` — ${command}` : ''}`,
        description,
        command,
        timestamp: new Date(),
      }
      sessionManager.setWaitingForApproval(sessionId, request)
      let decision: 'approve' | 'deny'
      try {
        decision = await approvalRegistry.waitForApproval(sessionId)
      } catch (err) {
        // dismissed — hook 返回错误响应，让 Claude Code 自己处理
        throw err instanceof Error ? err : new Error(String(err))
      }
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          permissionDecision: decision,
          permissionDecisionReason:
            decision === 'approve'
              ? 'User approved via Akari'
              : 'User rejected via Akari',
        },
      }
    }

    case 'StopFailure': {
      const { error } = event as StopFailurePayload
      const session = sessionManager.getSession(sessionId)
      if (session) {
        if (session.status === 'waiting') {
          approvalRegistry.resolveApproval(sessionId, 'rejected')
          try { sessionManager.updateStatus(sessionId, 'running') } catch { /* ignore */ }
        }
        if (['running', 'paused'].includes(session.status) ||
            (session.status === 'waiting' && !approvalRegistry.hasPending(sessionId))) {
          try { sessionManager.updateStatus(sessionId, 'failed') } catch { /* ignore */ }
        }
      }
      if (error) {
        sessionManager.pushTerminalMessage(
          sessionId,
          `\r\n\x1b[31m> [StopFailure] ${error}\x1b[0m\r\n`,
        )
      }
      return {}
    }

    case 'UserPromptSubmit': {
      const session = sessionManager.getSession(sessionId)
      if (session && (session.status === 'paused' || session.status === 'waiting')) {
        sessionManager.updateStatus(sessionId, 'running')
      }
      return {}
    }

    case 'Stop':
    case 'PostToolUse':
    case 'TaskCreated':
    case 'TaskCompleted':
      return {}

    default:
      return {}
  }
}
