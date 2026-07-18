import { describe, it, expect, vi } from 'vitest'
import { fileUpdateBus } from './fileUpdateBus'
import type { FileChangeEvent } from '@akari/shared-types'

describe('fileUpdateBus', () => {
  it('emits events to subscribed listeners', () => {
    const handler = vi.fn()
    const payload: FileChangeEvent = { sessionId: 's1', filePath: 'a.ts', changeType: 'change' }
    const unsubscribe = fileUpdateBus.on('s1', handler)
    fileUpdateBus.emit('s1', payload)
    expect(handler).toHaveBeenCalledWith(payload)
    unsubscribe()
  })

  it('does not notify listeners of other sessions', () => {
    const handler = vi.fn()
    fileUpdateBus.on('s1', handler)
    fileUpdateBus.emit('s2', { sessionId: 's2', filePath: 'b.ts', changeType: 'add' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribe removes listener', () => {
    const handler = vi.fn()
    const unsubscribe = fileUpdateBus.on('s1', handler)
    unsubscribe()
    fileUpdateBus.emit('s1', { sessionId: 's1', filePath: 'c.ts', changeType: 'unlink' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('destroy removes all listeners for session', () => {
    const handler = vi.fn()
    fileUpdateBus.on('s1', handler)
    fileUpdateBus.destroy('s1')
    fileUpdateBus.emit('s1', { sessionId: 's1', filePath: 'd.ts', changeType: 'change' })
    expect(handler).not.toHaveBeenCalled()
  })
})
