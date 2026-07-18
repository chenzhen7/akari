import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 500))
    expect(result.current).toBe('initial')
  })

  it('updates value after delay', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 500), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    expect(result.current).toBe('a')
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe('b')
  })

  it('resets timer on rapid changes', async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 500), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    rerender({ value: 'c' })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('a')
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('c')
  })

  it('clears timer on unmount', () => {
    const { result, rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 500), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    unmount()
    vi.advanceTimersByTime(500)
    expect(result.current).toBe('a')
  })
})
