import { useEffect, useRef, useCallback } from 'react'
import { useSessionStore, setWebSocket } from '@/stores/session-store'
import type { ServerMessage, ClientMessage } from '@akari/shared-types'

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
  return 'ws://127.0.0.1:39321/ws'
}

const WS_URL = getWsUrl()
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000
const RECONNECT_MAX_ATTEMPTS = 10

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

let socketInstance: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let attempt = 0

export function useWebSocket() {
  const mountedRef = useRef(false)
  const handleMessage = useSessionStore(s => s.handleServerMessage)
  const setConnStatus = useSessionStore(s => s.setConnectionStatus)

  const connect = useCallback(() => {
    if (socketInstance && socketInstance.readyState < WebSocket.CLOSING) return

    setConnStatus('connecting')
    const ws = new WebSocket(WS_URL)
    socketInstance = ws

    ws.onopen = () => {
      attempt = 0
      setConnStatus('connected')
      setWebSocket(ws)
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMessage
        handleMessage(msg)
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
  }, [handleMessage, setConnStatus])

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
