import { describe, it, expect, vi } from 'vitest'
import { dispatchHookEvent } from '../services/hook-dispatcher.service.js'
import type { SessionManager } from '../session-manager.js'

function createMockSessionManager(overrides: Partial<SessionManager> = {}): SessionManager {
  return {
    getSession: vi.fn(),
    updateStatus: vi.fn(),
    pushTerminalMessage: vi.fn(),
    setLastAiMessage: vi.fn(),
    broadcastMessage: vi.fn(),
    ...overrides,
  } as unknown as SessionManager
}

describe('dispatchHookEvent', () => {
  it('broadcasts session:unread on PermissionRequest without changing state', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const manager = createMockSessionManager()

    const result = await dispatchHookEvent('session-1', {
      hook_event_name: 'PermissionRequest',
      session_id: 'session-1',
      tool_name: 'Edit',
      tool_input: { command: 'rm -rf /' },
    }, manager)

    expect(result).toEqual({})
    expect(manager.updateStatus).not.toHaveBeenCalled()
    expect(manager.broadcastMessage).toHaveBeenCalledWith({
      event: 'session:unread',
      payload: { id: 'session-1' },
    })
    expect(consoleSpy).toHaveBeenCalledWith('[PermissionRequest] session=session-1 tool=Edit command=rm -rf /')
    consoleSpy.mockRestore()
  })

  it('logs PermissionRequest without command when missing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const manager = createMockSessionManager()

    await dispatchHookEvent('session-1', {
      hook_event_name: 'PermissionRequest',
      session_id: 'session-1',
      tool_name: 'Read',
      tool_input: {},
    }, manager)

    expect(consoleSpy).toHaveBeenCalledWith('[PermissionRequest] session=session-1 tool=Read')
    consoleSpy.mockRestore()
  })

  it('broadcasts session:unread and session:lastMessage on Stop without changing state', async () => {
    const manager = createMockSessionManager()

    await dispatchHookEvent('session-1', {
      hook_event_name: 'Stop',
      session_id: 'session-1',
      last_assistant_message: 'Done!',
    }, manager)

    expect(manager.updateStatus).not.toHaveBeenCalled()
    expect(manager.setLastAiMessage).toHaveBeenCalledWith('session-1', 'Done!')
    expect(manager.broadcastMessage).toHaveBeenCalledWith({
      event: 'session:lastMessage',
      payload: { id: 'session-1', lastAiMessage: 'Done!' },
    })
    expect(manager.broadcastMessage).toHaveBeenCalledWith({
      event: 'session:unread',
      payload: { id: 'session-1' },
    })
  })

  it('skips last message broadcast for empty message on Stop but still marks unread', async () => {
    const manager = createMockSessionManager()

    await dispatchHookEvent('session-1', {
      hook_event_name: 'Stop',
      session_id: 'session-1',
      last_assistant_message: '   ',
    }, manager)

    expect(manager.setLastAiMessage).not.toHaveBeenCalled()
    expect(manager.broadcastMessage).toHaveBeenCalledTimes(1)
    expect(manager.broadcastMessage).toHaveBeenCalledWith({
      event: 'session:unread',
      payload: { id: 'session-1' },
    })
  })
})
