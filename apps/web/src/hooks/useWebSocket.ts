import { useEffect, useRef, useCallback } from 'react'
import { handleServerMessage } from '@/stores/server-message-handler'
import { setWebSocket, useConnectionStore, type ConnectionStatus } from '@/stores/connection-store'
import { useWindowStore } from '@/stores/window-store'
import type { ClientMessage, ServerMessage } from '@akari/shared-types'

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
  return 'ws://localhost:3001/ws'
}

const WS_URL = getWsUrl()
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 10

export type { ConnectionStatus }

let socketInstance: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let attempt = 0

export function useWebSocket() {
  const mountedRef = useRef(false)
  const setConnStatus = useConnectionStore(s => s.setConnectionStatus)
  const workspaceId = useWindowStore(s => s.workspaceId)

  const connect = useCallback(() => {
    if (socketInstance && socketInstance.readyState < WebSocket.CLOSING) return

    setConnStatus('connecting')
    const ws = new WebSocket(WS_URL)
    socketInstance = ws

    ws.onopen = () => {
      attempt = 0
      setConnStatus('connected')
      setWebSocket(ws)

      // Subscribe to the current window's workspace so the server filters broadcasts
      const currentWorkspaceId = useWindowStore.getState().workspaceId
      if (currentWorkspaceId) {
        ws.send(JSON.stringify({ event: 'subscribe:workspace', payload: { workspaceId: currentWorkspaceId } } satisfies ClientMessage))
      }

      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage
        handleServerMessage(msg)
      } catch {
        console.warn('[WS] Failed to parse message', ev.data)
      }
    }

    ws.onclose = () => {
      socketInstance = null
      if (!mountedRef.current) return
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        setConnStatus('failed')
        return
      }
      setConnStatus('disconnected')
      attempt++
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS)
      reconnectTimer = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [setConnStatus])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }
  }, [connect])

  // Re-subscribe when workspaceId changes (e.g. after window init resolves it)
  useEffect(() => {
    if (!workspaceId || !socketInstance || socketInstance.readyState !== WebSocket.OPEN) return
    socketInstance.send(JSON.stringify({ event: 'subscribe:workspace', payload: { workspaceId } } satisfies ClientMessage))
  }, [workspaceId])

  const send = useCallback((msg: ClientMessage) => {
    if (socketInstance?.readyState === WebSocket.OPEN) {
      socketInstance.send(JSON.stringify(msg))
    } else {
      console.warn('[WS] Cannot send, socket not open')
    }
  }, [])

  const reconnect = useCallback(() => {
    attempt = 0
    if (socketInstance) {
      socketInstance.close()
      socketInstance = null
    }
    connect()
  }, [connect])

  return { send, reconnect }
}
