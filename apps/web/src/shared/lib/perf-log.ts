/**
 * 轻量性能打点工具（排查首次加载慢的问题用）。
 * 用法：perfMark(key) 记录起点，perfMeasure(key, label) 输出从起点到当前的耗时。
 * 同一个 key 可多次 perfMeasure，用于观察链路上各节点的累计耗时。
 * 日志统一带 [Perf] 前缀，方便在 DevTools Console 中过滤。
 */

const marks = new Map<string, number>()

export function perfNow(): number {
  return performance.now()
}

export function perfMark(key: string, label?: string): void {
  marks.set(key, performance.now())
  console.info(`[Perf] ${label ?? key}`)
}

export function perfMeasure(key: string, label: string): void {
  const start = marks.get(key)
  if (start === undefined) {
    console.info(`[Perf] ${label} (无起点记录)`)
    return
  }
  const elapsed = performance.now() - start
  console.info(`[Perf] ${label}: ${elapsed.toFixed(1)}ms（距起点）`)
}
