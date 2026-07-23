import { describe, it, expect } from 'vitest'
import { createResizeMutex } from '../ptyResizeMutex'

describe('createResizeMutex', () => {
  it('acquires lock on first call', () => {
    const mutex = createResizeMutex()
    expect(mutex.acquire('s1')).toBe(true)
    expect(mutex.isResizing('s1')).toBe(true)
  })

  it('rejects second acquire while busy', () => {
    const mutex = createResizeMutex()
    mutex.acquire('s1')
    expect(mutex.acquire('s1')).toBe(false)
  })

  it('isolates sessions', () => {
    const mutex = createResizeMutex()
    expect(mutex.acquire('s1')).toBe(true)
    expect(mutex.acquire('s2')).toBe(true)
    expect(mutex.isResizing('s1')).toBe(true)
    expect(mutex.isResizing('s2')).toBe(true)
  })

  it('buffers data while resizing', () => {
    const mutex = createResizeMutex()
    mutex.acquire('s1')
    expect(mutex.buffer('s1', 'abc')).toBe(true)
    expect(mutex.buffer('s1', 'def')).toBe(true)
    expect(mutex.release('s1')).toEqual(['abc', 'def'])
  })

  it('does not buffer when not resizing', () => {
    const mutex = createResizeMutex()
    expect(mutex.buffer('s1', 'abc')).toBe(false)
  })

  it('clears busy flag on release', () => {
    const mutex = createResizeMutex()
    mutex.acquire('s1')
    mutex.release('s1')
    expect(mutex.isResizing('s1')).toBe(false)
  })

  it('flush drains buffer without releasing lock', () => {
    const mutex = createResizeMutex()
    mutex.acquire('s1')
    mutex.buffer('s1', 'a')
    mutex.buffer('s1', 'b')
    expect(mutex.flush('s1')).toEqual(['a', 'b'])
    expect(mutex.isResizing('s1')).toBe(true)
    expect(mutex.flush('s1')).toEqual([])
  })

  it('returns empty array for unknown session on release', () => {
    const mutex = createResizeMutex()
    expect(mutex.release('unknown')).toEqual([])
  })
})
