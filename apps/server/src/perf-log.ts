/**
 * 服务端轻量性能打点工具（排查首次加载慢的问题用）。
 * 日志统一带 [Perf] 前缀；打包后经 Electron 主进程 stdout 管道写入 electron-log（带 [server] 前缀）。
 */

export function perfNow(): number {
  return performance.now()
}

export function perfLog(label: string, startMs: number): void {
  const elapsed = performance.now() - startMs
  console.log(`[Perf] ${label}: ${elapsed.toFixed(1)}ms`)
}
