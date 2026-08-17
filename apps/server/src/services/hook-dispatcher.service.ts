import type {
  HookEvent,
  HookResponse,
} from '@akari/shared-types'
import type { SessionManager } from '../session-manager.js'

/**
 * Hook 事件只负责「未读提醒」：PermissionRequest / Stop 到达时广播 session:unread，
 * 前端据此在侧边栏给会话显示红点。Hook 不再驱动会话状态机流转。
 */
export async function dispatchHookEvent(
  sessionId: string,
  event: HookEvent,
  sessionManager: SessionManager,
): Promise<HookResponse> {
  switch (event.hook_event_name) {
    case 'PermissionRequest': {
      const { tool_name, tool_input } = event
      const command = typeof tool_input?.['command'] === 'string' ? tool_input['command'] : undefined
      console.log(`[PermissionRequest] session=${sessionId} tool=${tool_name}${command ? ` command=${command}` : ''}`)
      // 仅做未读提醒，不拦截 Claude Code 的原生权限确认流程
      sessionManager.broadcastMessage({
        event: 'session:unread',
        payload: { id: sessionId },
      })
      return {}
    }

    case 'Stop': {
      const { last_assistant_message } = event
      if (last_assistant_message && last_assistant_message.trim().length > 0) {
        sessionManager.setLastAiMessage(sessionId, last_assistant_message)
        sessionManager.broadcastMessage({
          event: 'session:lastMessage',
          payload: { id: sessionId, lastAiMessage: last_assistant_message },
        })
      }
      sessionManager.broadcastMessage({
        event: 'session:unread',
        payload: { id: sessionId },
      })
      return {}
    }

    default:
      return {}
  }
}
