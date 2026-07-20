export function runWhenIdle(task: () => void, timeoutMs = 3000): () => void {
  if (typeof window === 'undefined') {
    task()
    return () => {}
  }

  let cancelled = false

  if (window.requestIdleCallback && window.cancelIdleCallback) {
    let handle = 0
    const run = (deadline: IdleDeadline): void => {
      if (cancelled) return
      if (!deadline.didTimeout && deadline.timeRemaining() < 1) {
        handle = window.requestIdleCallback(run, { timeout: timeoutMs })
        return
      }
      task()
    }

    handle = window.requestIdleCallback(run, { timeout: timeoutMs })

    return () => {
      cancelled = true
      window.cancelIdleCallback(handle)
    }
  }

  const timer = window.setTimeout(() => {
    if (!cancelled) task()
  }, timeoutMs)

  return () => {
    cancelled = true
    window.clearTimeout(timer)
  }
}
