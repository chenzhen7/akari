import { resolve } from 'node:path'
import type { ServerMessage } from '@akari/shared-types'
import { perfLog, perfNow } from '../perf-log.js'
import { IWorktreeService } from './worktree.service.js'

type RefreshKind = 'changeList' | 'gitLog'

interface RefreshEntry {
  sessionId: string
  path: string
  pending: Set<RefreshKind>
  timer: ReturnType<typeof setTimeout> | null
  running: Promise<void> | null
  /** 正在刷新期间又收到新事件 → 跑完补跑一次（trailing），防止丢事件 */
  rerun: boolean
}

/**
 * 变更列表 / git log 的刷新协调器。
 *
 * 写操作（commit/merge/pull/…）与文件监听事件只调用 `schedule*`，快速返回；
 * 真正的重算由这里 250ms 防抖合并、in-flight 去重后异步执行，响应不被 git 命令拖慢。
 *
 * 事件流：
 * - Agent 写文件          → watchDiff.onChanged → scheduleChangeList（不动 git log，图不闪）
 * - 外部 git commit/push  → metadata watcher    → scheduleFullRefresh（列表 + 图都刷）
 * - 应用内写操作          → scheduleGitRefresh   → 同前按 full 分流
 */
export class GitRefreshCoordinator {
  private readonly entries = new Map<string, RefreshEntry>()
  private readonly DEBOUNCE_MS = 250

  constructor(
    private readonly worktreeService: IWorktreeService,
    private readonly persistDiffSummary: (sessionId: string, summary: { additions: number; deletions: number }) => void,
    private readonly broadcast: (msg: ServerMessage) => void,
  ) {}

  /** 只重算变更列表并广播 diff:update（不动 git log，图不闪） */
  scheduleChangeList(sessionId: string, path: string): void {
    this.schedule(sessionId, path, 'changeList')
  }

  /** 只重算 git log 并广播 git:log-updated */
  scheduleGitLog(sessionId: string, path: string): void {
    this.schedule(sessionId, path, 'gitLog')
  }

  /** 变更列表 + git log 一起刷（HEAD/refs 变化，图也要动） */
  scheduleFullRefresh(sessionId: string, path: string): void {
    this.schedule(sessionId, path, 'changeList', 'gitLog')
  }

  private schedule(sessionId: string, path: string, ...kinds: RefreshKind[]): void {
    const key = resolve(path)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { sessionId, path: key, pending: new Set(), timer: null, running: null, rerun: false }
      this.entries.set(key, entry)
    }
    for (const kind of kinds) entry.pending.add(kind)
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry!.timer = null
      void this.flush(entry!)
    }, this.DEBOUNCE_MS)
  }

  private async flush(entry: RefreshEntry): Promise<void> {
    // 正在跑又触发 → 标记补跑，当前这次跑完自动再跑一轮
    if (entry.running) {
      entry.rerun = true
      return
    }
    entry.rerun = false
    const kinds = [...entry.pending]
    entry.pending.clear()
    entry.running = this.runKinds(entry.sessionId, entry.path, kinds)
    try {
      await entry.running
    } finally {
      entry.running = null
      if (entry.rerun || entry.pending.size > 0) {
        void this.flush(entry)
      }
    }
  }

  private async runKinds(sessionId: string, path: string, kinds: RefreshKind[]): Promise<void> {
    if (kinds.includes('changeList')) {
      await this.runChangeList(sessionId, path)
    }
    if (kinds.includes('gitLog')) {
      await this.runGitLog(sessionId, path)
    }
  }

  private async runChangeList(sessionId: string, path: string): Promise<void> {
    const t0 = perfNow()
    try {
      // 先失效缓存再取，保证拿到的不是旧快照（写操作/文件事件后 diff 缓存可能仍有效）
      this.worktreeService.invalidateDiffCache(path)
      const diff = await this.worktreeService.getCurrentDiff(path)
      this.persistDiffSummary(sessionId, diff.summary)
      this.broadcast({ event: 'diff:update', payload: { sessionId, diff } })
    } catch (err) {
      console.warn(`[GitRefreshCoordinator] changeList refresh failed for ${sessionId} @ ${path}:`, err)
    } finally {
      perfLog(`[GitRefreshCoordinator] changeList refresh @ ${path}`, t0)
    }
  }

  private async runGitLog(sessionId: string, path: string): Promise<void> {
    const t0 = perfNow()
    try {
      // commit 后 1.5s TTL 缓存仍可能命中旧 log，必须先失效再取
      this.worktreeService.invalidateGitLogCache(path)
      const log = await this.worktreeService.getGitLog(path, 100, 0)
      this.broadcast({ event: 'git:log-updated', payload: { sessionId, ...log } })
    } catch (err) {
      console.warn(`[GitRefreshCoordinator] git log refresh failed for ${sessionId} @ ${path}:`, err)
    } finally {
      perfLog(`[GitRefreshCoordinator] git log refresh @ ${path}`, t0)
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.entries.clear()
  }
}
