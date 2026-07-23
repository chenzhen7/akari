import type {
  HookEvent,
  HookResponse,
  StopFailurePayload,
} from '@akari/shared-types'
import type { SessionManager } from '../session-manager.js'
import { validateTransition } from '../session-manager.js'

export async function dispatchHookEvent(
  sessionId: string,
  event: HookEvent,
  sessionManager: SessionManager,
): Promise<HookResponse> {
  switch (event.hook_event_name) {
    case 'SessionStart': {
      const session = sessionManager.getSession(sessionId)
      if (session && session.status === 'initializing') {
        sessionManager.updateStatus(sessionId, 'idle')
      }
      return {}
    }

    case 'PermissionRequest': {
      const { tool_name, tool_input } = event as { hook_event_name: 'PermissionRequest'; tool_name: string; tool_input: Record<string, unknown> }
      const command = typeof tool_input?.['command'] === 'string' ? tool_input['command'] : undefined
      console.log(`[PermissionRequest] session=${sessionId} tool=${tool_name}${command ? ` command=${command}` : ''}`)
      // 仅做审批通知，不修改状态，也不拦截 Claude Code 的原生权限确认流程
      return {}
    }

    case 'StopFailure': {
      const { error } = event as StopFailurePayload
      const session = sessionManager.getSession(sessionId)
      if (session) {
        if (session.status === 'waiting' && validateTransition(session.status, 'running')) {
          sessionManager.updateStatus(sessionId, 'running')
        }
        if ((['running', 'paused'].includes(session.status) || session.status === 'waiting') && validateTransition(session.status, 'failed')) {
          sessionManager.updateStatus(sessionId, 'failed')
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
      console.log('[UserPromptSubmit hook]', JSON.stringify(event, null, 2))
      const session = sessionManager.getSession(sessionId)
      if (session && ['paused', 'waiting', 'idle'].includes(session.status) && validateTransition(session.status, 'running')) {
        sessionManager.updateStatus(sessionId, 'running')
      }
      return {}
    }

    case 'Stop': {
      const { last_assistant_message } = event as import('@akari/shared-types').StopPayload
      const session = sessionManager.getSession(sessionId)
      if (session && ['running', 'waiting'].includes(session.status) && validateTransition(session.status, 'idle')) {
        sessionManager.updateStatus(sessionId, 'idle')
      }
      if (last_assistant_message && last_assistant_message.trim().length > 0) {
        sessionManager.setLastAiMessage(sessionId, last_assistant_message)
        sessionManager.broadcastMessage({
          event: 'session:lastMessage',
          payload: { id: sessionId, lastAiMessage: last_assistant_message },
        })
      }
      return {}
    }
    case 'PostToolUse':
    case 'TaskCreated':
    case 'TaskCompleted':
      return {}

    default:
      return {}
  }
}
