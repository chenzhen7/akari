/**
 * Frontend mutex for terminal resize coordination.
 *
 * Problem: ResizeObserver fires rapidly during window resize, and the backend
 * PTY resize + ConPTY re-render race against incoming terminal:data events.
 * This module serialises the frontend side of the resize cycle so that:
 *  1. Repeated resize triggers within the debounce window are coalesced (last-write-wins).
 *  2. Terminal data arriving from the server while a resize is in-flight is buffered.
 *  3. On 'terminal:resized' the buffered data is flushed in one batch.
 *
 * Usage:
 *   const mutex = createResizeMutex()
 *   // start resize
 *   if (!mutex.acquire(sessionId)) return  // another resize already in flight
 *   fitAddon.fit()
 *   send({ event: 'terminal:resize', payload: { sessionId, cols, rows } })
 *
 *   // ... later, when 'terminal:resized' arrives from server ...
 *   const buffered = mutex.release(sessionId)
 *   if (buffered.length > 0) term.write(buffered.join(''))
 */

interface MutexState {
  /** True while we have sent a resize and are waiting for terminal:resized */
  busy: boolean
  /** Data chunks received while busy = true */
  buffer: string[]
}

export interface ResizeMutex {
  /**
   * Begin a resize sequence for `sessionId`.
   * Returns true if the lock was acquired; false if a resize is already in flight
   * (the caller should discard this event).
   */
  acquire(sessionId: string): boolean

  /**
   * Signal that `sessionId`'s PTY has finished resizing.
   * Returns all buffered data chunks (if any) that accumulated during the resize.
   */
  release(sessionId: string): string[]

  /**
   * True while a resize is in flight (acquired but not yet released).
   */
  isResizing(sessionId: string): boolean

  /**
   * Push a data chunk into the buffer if a resize is in flight for this session.
   * Returns true if buffered, false if passed straight through.
   */
  buffer(sessionId: string, data: string): boolean
}

function createResizeMutex(): ResizeMutex {
  const states = new Map<string, MutexState>()

  function getOrCreate(sessionId: string): MutexState {
    let s = states.get(sessionId)
    if (!s) {
      s = { busy: false, buffer: [] }
      states.set(sessionId, s)
    }
    return s
  }

  return {
    acquire(sessionId: string): boolean {
      const s = getOrCreate(sessionId)
      if (s.busy) return false
      s.busy = true
      s.buffer = []
      return true
    },

    release(sessionId: string): string[] {
      const s = states.get(sessionId)
      if (!s) return []
      const chunks = s.buffer.splice(0)
      s.busy = false
      return chunks
    },

    isResizing(sessionId: string): boolean {
      return states.get(sessionId)?.busy ?? false
    },

    buffer(sessionId: string, data: string): boolean {
      const s = states.get(sessionId)
      if (!s || !s.busy) return false
      s.buffer.push(data)
      return true
    },
  }
}

export const resizeMutex = createResizeMutex()
