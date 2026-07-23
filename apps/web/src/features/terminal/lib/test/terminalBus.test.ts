import { describe, it, expect, vi } from 'vitest'
import { terminalBus } from '../terminalBus'

describe('terminalBus', () => {
  it('emits data to subscribed listeners', () => {
    const handler = vi.fn()
    const unsubscribe = terminalBus.on('session-a', handler)
    terminalBus.emit('session-a', 'hello')
    expect(handler).toHaveBeenCalledWith('hello')
    unsubscribe()
  })

  it('does not notify listeners of other sessions', () => {
    const handler = vi.fn()
    terminalBus.on('session-a', handler)
    terminalBus.emit('session-b', 'hello')
    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribe removes listener', () => {
    const handler = vi.fn()
    const unsubscribe = terminalBus.on('session-c', handler)
    unsubscribe()
    terminalBus.emit('session-c', 'hello')
    expect(handler).not.toHaveBeenCalled()
  })

  it('buffers emitted data for replay', () => {
    terminalBus.emit('session-d', 'line1')
    terminalBus.emit('session-d', 'line2')
    expect(terminalBus.getBuffer('session-d')).toEqual(['line1', 'line2'])
  })

  it('clears buffer and sends ANSI clear', () => {
    const handler = vi.fn()
    terminalBus.on('session-e', handler)
    terminalBus.emit('session-e', 'data')
    terminalBus.clear('session-e')
    expect(terminalBus.getBuffer('session-e')).toEqual([])
    expect(handler).toHaveBeenLastCalledWith('\x1b[2J\x1b[H')
  })

  it('destroys session listeners and buffer', () => {
    const handler = vi.fn()
    terminalBus.on('session-f', handler)
    terminalBus.emit('session-f', 'data')
    terminalBus.destroy('session-f')
    expect(terminalBus.getBuffer('session-f')).toEqual([])
    terminalBus.emit('session-f', 'more')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('notifies resized listeners', () => {
    const handler = vi.fn()
    const unsubscribe = terminalBus.onResized('session-g', handler)
    terminalBus.resized('session-g')
    expect(handler).toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps buffer within limit', () => {
    const sessionId = 'session-limit'
    for (let i = 0; i < 5002; i++) {
      terminalBus.emit(sessionId, `line${i}`)
    }
    const buffer = terminalBus.getBuffer(sessionId)
    expect(buffer.length).toBe(5000)
    expect(buffer[0]).toBe('line2')
  })
})
