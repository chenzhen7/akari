type Handler = (data: string) => void

const _listeners = new Map<string, Set<Handler>>()
const _buffers = new Map<string, string[]>()
const BUFFER_LIMIT = 5000

export const terminalBus = {
  /** Write PTY data: store in ring buffer and notify all listeners immediately */
  emit(sessionId: string, data: string): void {
    let buf = _buffers.get(sessionId)
    if (!buf) {
      buf = []
      _buffers.set(sessionId, buf)
    }
    buf.push(data)
    if (buf.length > BUFFER_LIMIT) buf.shift()
    _listeners.get(sessionId)?.forEach(h => h(data))
  },

  /** Subscribe to PTY data for a session. Returns an unsubscribe function. */
  on(sessionId: string, handler: Handler): () => void {
    if (!_listeners.has(sessionId)) _listeners.set(sessionId, new Set())
    _listeners.get(sessionId)!.add(handler)
    return () => {
      _listeners.get(sessionId)?.delete(handler)
    }
  },

  /** Clear the ring buffer and notify listeners with ANSI clear sequence. */
  clear(sessionId: string): void {
    _buffers.set(sessionId, [])
    _listeners.get(sessionId)?.forEach(h => h('\x1b[2J\x1b[H'))
  },

  /** Remove all listeners and buffer for a session (call on session delete). */
  destroy(sessionId: string): void {
    _listeners.delete(sessionId)
    _buffers.delete(sessionId)
  },

  /**
   * Notify all listeners for a session that the PTY has finished resizing.
   * Listeners (TerminalPanel) use this to flush their frontend-side resize buffer.
   */
  resized(sessionId: string): void {
    _resizedListeners.get(sessionId)?.forEach(h => h())
  },

  /** Subscribe to resize-complete notifications for a session. */
  onResized(sessionId: string, handler: () => void): () => void {
    if (!_resizedListeners.has(sessionId)) _resizedListeners.set(sessionId, new Set())
    _resizedListeners.get(sessionId)!.add(handler)
    return () => {
      _resizedListeners.get(sessionId)?.delete(handler)
    }
  },
}

const _resizedListeners = new Map<string, Set<() => void>>()
