import { create } from 'zustand'
import type { AgentType } from '@akari/shared-types'
import { terminalBus } from '@/features/terminal/lib/terminalBus'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

interface ConnectionStore {
  connectionStatus: ConnectionStatus
  disconnectedAt: number | null
  terminalReadyTick: Record<string, number>

  setConnectionStatus: (status: ConnectionStatus) => void
  addTerminalLine: (id: string, line: string) => void
  clearTerminal: (id: string) => void
  createTerminal: (sessionId: string, agentType?: AgentType, bypassPermissions?: boolean) => void
  sendTerminalInput: (sessionId: string, terminalId: string, data: string) => boolean
}

let _ws: WebSocket | null = null

export function setWebSocket(ws: WebSocket | null): void {
  _ws = ws
}

export function getWebSocket(): WebSocket | null {
  return _ws
}

export function sendWsMessage<T>(event: string, payload: T): boolean {
  const ws = getWebSocket()
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, payload }))
    return true
  }
  return false
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connectionStatus: 'connecting',
  disconnectedAt: null,
  terminalReadyTick: {},

  setConnectionStatus: (status) => {
    set((state) => ({
      connectionStatus: status,
      disconnectedAt:
        status === 'disconnected' && state.connectionStatus === 'connected'
          ? Date.now()
          : status === 'connected'
            ? null
            : state.disconnectedAt,
    }))
  },

  addTerminalLine: (id, line) => {
    terminalBus.emit(id, line)
  },

  clearTerminal: (id) => {
    terminalBus.clear(id)
  },

  createTerminal: (sessionId, agentType, bypassPermissions) => {
    sendWsMessage('terminal:create', { sessionId, agentType, bypassPermissions })
  },

  sendTerminalInput: (sessionId, terminalId, data) =>
    sendWsMessage('terminal:input', { sessionId, terminalId, data }),
}))
