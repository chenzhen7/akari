import { describe, it, expect, vi } from 'vitest'
import { dispatchHookEvent } from './hook-dispatcher.js'
import type { SessionManager } from './session-manager.js'
import type { AgentSession, SessionStatus } from '@akari/shared-types'

function createMockSession(status: SessionStatus): AgentSession {
  return {
    id: 'session-1',
    name: 'Test Session',
    task: 'test task',
    status,
    agentType: 'claude',
    worktreePath: '/worktree',
    branchName: 'agent/session',
    baseBranch: 'main',
    canvasPosition: { x: 0, y: 0 },
    canvasSize: { width: 280, height: 280 },
    kanbanColumn: 'backlog',
    terminalId: 'term-1',
    progress: 0,
    terminalOutput: [],
    lastAiMessage: '',
    diffSummary: { additions: 0, deletions: 0 },
    createdAt: new Date(),
    tags: [],
    collaborationRole: 'standalone',
    childSessionIds: [],
    tabs: [],
    activeTabId: null,
    workspaceId: 'ws-1',
  }
}

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
  it('returns empty object for SessionStart and transitions initializing -> idle', async () => {
    const session = createMockSession('initializing')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })

    const result = await dispatchHookEvent('session-1', { hook_event_name: 'SessionStart' }, manager)

    expect(result).toEqual({})
    expect(manager.updateStatus).toHaveBeenCalledWith('session-1', 'idle')
  })

  it('does not transition for SessionStart if session is not initializing', async () => {
    const session = createMockSession('idle')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })

    await dispatchHookEvent('session-1', { hook_event_name: 'SessionStart' }, manager)

    expect(manager.updateStatus).not.toHaveBeenCalled()
  })

  it('logs PermissionRequest without changing state', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const manager = createMockSessionManager()

    await dispatchHookEvent('session-1', {
      hook_event_name: 'PermissionRequest',
      tool_name: 'Edit',
      tool_input: { command: 'rm -rf /' },
    } as any, manager)

    expect(manager.updateStatus).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('[PermissionRequest] session=session-1 tool=Edit command=rm -rf /')
    consoleSpy.mockRestore()
  })

  it('logs PermissionRequest without command when missing', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const manager = createMockSessionManager()

    await dispatchHookEvent('session-1', {
      hook_event_name: 'PermissionRequest',
      tool_name: 'Read',
      tool_input: {},
    } as any, manager)

    expect(consoleSpy).toHaveBeenCalledWith('[PermissionRequest] session=session-1 tool=Read')
    consoleSpy.mockRestore()
  })

  it('transitions paused/waiting/idle -> running on UserPromptSubmit', async () => {
    for (const status of ['paused', 'waiting', 'idle'] as SessionStatus[]) {
      const session = createMockSession(status)
      const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await dispatchHookEvent('session-1', { hook_event_name: 'UserPromptSubmit' }, manager)

      expect(manager.updateStatus).toHaveBeenCalledWith('session-1', 'running')
      consoleSpy.mockRestore()
    }
  })

  it('does not transition invalid status on UserPromptSubmit', async () => {
    const session = createMockSession('completed')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await dispatchHookEvent('session-1', { hook_event_name: 'UserPromptSubmit' }, manager)

    expect(manager.updateStatus).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('transitions running/waiting -> idle on Stop and sets last message', async () => {
    const session = createMockSession('running')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })

    await dispatchHookEvent('session-1', {
      hook_event_name: 'Stop',
      last_assistant_message: 'Done!',
    } as any, manager)

    expect(manager.updateStatus).toHaveBeenCalledWith('session-1', 'idle')
    expect(manager.setLastAiMessage).toHaveBeenCalledWith('session-1', 'Done!')
    expect(manager.broadcastMessage).toHaveBeenCalledWith({
      event: 'session:lastMessage',
      payload: { id: 'session-1', lastAiMessage: 'Done!' },
    })
  })

  it('skips last message broadcast for empty message on Stop', async () => {
    const session = createMockSession('running')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })

    await dispatchHookEvent('session-1', {
      hook_event_name: 'Stop',
      last_assistant_message: '   ',
    } as any, manager)

    expect(manager.setLastAiMessage).not.toHaveBeenCalled()
    expect(manager.broadcastMessage).not.toHaveBeenCalled()
  })

  it('transitions to failed on StopFailure and pushes terminal message', async () => {
    const session = createMockSession('running')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })

    await dispatchHookEvent('session-1', {
      hook_event_name: 'StopFailure',
      error: 'something went wrong',
    } as any, manager)

    expect(manager.updateStatus).toHaveBeenCalledWith('session-1', 'failed')
    expect(manager.pushTerminalMessage).toHaveBeenCalledWith(
      'session-1',
      '\r\n\x1b[31m> [StopFailure] something went wrong\x1b[0m\r\n',
    )
  })

  it('recovers waiting -> running before failed on StopFailure', async () => {
    const session = createMockSession('waiting')
    const manager = createMockSessionManager({ getSession: vi.fn().mockReturnValue(session) })

    await dispatchHookEvent('session-1', {
      hook_event_name: 'StopFailure',
      error: 'timeout',
    } as any, manager)

    expect(manager.updateStatus).toHaveBeenCalledTimes(2)
    expect(manager.updateStatus).toHaveBeenNthCalledWith(1, 'session-1', 'running')
    expect(manager.updateStatus).toHaveBeenNthCalledWith(2, 'session-1', 'failed')
  })

  it('does nothing for PostToolUse', async () => {
    const manager = createMockSessionManager()

    const result = await dispatchHookEvent('session-1', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: {},
    } as any, manager)

    expect(result).toEqual({})
    expect(manager.updateStatus).not.toHaveBeenCalled()
  })
})
