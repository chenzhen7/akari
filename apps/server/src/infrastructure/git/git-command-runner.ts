import { execa } from 'execa'
import { resolve } from 'node:path'
import { perfLog, perfNow } from '../../perf-log.js'

export type GitErrorCode =
  | 'NOT_A_GIT_REPO'
  | 'NOTHING_TO_COMMIT'
  | 'MERGE_CONFLICT'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_FAILED'
  | 'LOCKED'
  | 'NO_REMOTE'
  | 'NO_UPSTREAM'
  | 'UNKNOWN'

export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: GitErrorCode,
    public readonly args: string[],
    public readonly cwd: string,
    /**
     * 保留底层 execa 错误的退出码/stdout：`git diff --no-index` 以退出码 1 表示
     * 「存在差异」（未跟踪文件对比 /dev/null 的正常结果），stdout 里带着完整 diff，
     * 调用方需要读取它们而不是当作失败丢弃。
     */
    public readonly exitCode?: number,
    public readonly stdout?: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitRunOptions {
  timeout?: number
  /**
   * 'write'（默认）：进入 per-repo 串行写锁，保证 add/commit/checkout/merge/pull/push
   * 等修改仓库状态的操作彼此绝不重叠。
   * 'read'：跳过写锁，走全局并发读池（Limiter），用于 status/diff/log/show 等只读命令。
   * 漏标默认是 'write'，即便误标也只影响并发、不破坏写串行化。
   */
  mode?: 'read' | 'write'
  /**
   * 默认 true → 对 diff 命令注入 --no-renames（确定性好：rename 表现为 D+A 两条记录）。
   * false → 只注入 --no-ext-diff，保留 rename 检测（暂无用例，预留）。
   */
  renames?: boolean
}

/** 全局并发读池：限制同时 spawn 的只读 git 进程数，避免 IO 尖峰。 */
class ReadLimiter {
  private readonly waiters: Array<() => void> = []
  private active = 0

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiters.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}

/** 所有 git 命令注入的稳定环境：禁用 optional lock（status 不抢 index 锁）、固定 locale。 */
const GIT_ENV = { LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0' }

/**
 * Centralized Git command executor.
 *
 * Responsibilities:
 * - Serialize WRITE git commands per repository root to avoid IO spikes.
 * - Let READ commands (status/diff/log) run concurrently via a global limiter,
 *   so heavy reads never block a user's commit/push.
 * - Disable pager and enforce consistent quoting.
 * - Add --no-ext-diff and --no-renames to diff commands.
 * - Apply a default timeout so git commands cannot hang forever.
 * - Classify common git errors so callers can react specifically.
 */
export class GitCommandRunner {
  private readonly writeLocks = new Map<string, Promise<unknown>>()
  private readonly readLimiter = new ReadLimiter(4)
  private readonly defaultTimeout = 30000

  async run(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    if (options.mode === 'read') {
      return this.runRead(args, cwd, options)
    }
    const key = resolve(cwd)
    const enqueueAt = perfNow()
    const previous = this.writeLocks.get(key) ?? Promise.resolve()
    const task = previous.then(() => {
      const queueWait = perfNow() - enqueueAt
      if (queueWait > 50) {
        console.log(`[Perf] [git] 排队等待 ${queueWait.toFixed(1)}ms: git ${args.join(' ')} @ ${key}`)
      }
      return this.execWithPerf(args, cwd, options)
    })
    this.writeLocks.set(key, task.catch(() => {}))
    return task
  }

  runRead(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    return this.readLimiter.run(() => this.execWithPerf(args, cwd, options))
  }

  private execWithPerf(args: string[], cwd: string, options: GitRunOptions): Promise<string> {
    const t0 = perfNow()
    return this.exec(args, cwd, options).finally(() => {
      perfLog(`[git] 执行 git ${args.join(' ')} @ ${resolve(cwd)}`, t0)
    })
  }

  private async exec(args: string[], cwd: string, options: GitRunOptions): Promise<string> {
    const normalizedArgs = this.normalizeArgs(args, options)
    try {
      const result = await execa('git', normalizedArgs, {
        cwd,
        timeout: options.timeout ?? this.defaultTimeout,
        env: { ...process.env, ...GIT_ENV },
      })
      return result.stdout
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const firstLine = message.split(/\r?\n/)[0] ?? message
      const exitCode = (err as { exitCode?: number }).exitCode
      // `git diff --no-index` 以退出码 1 表示「存在差异」（未跟踪文件的正常结果），
      // 不是命令失败，不应误报日志；stdout 里的 diff 由调用方通过 GitError 读取。
      if (!(args[0] === 'diff' && args.includes('--no-index') && exitCode === 1)) {
        console.error(`[git] command failed: git ${args.join(' ')} in ${cwd}: ${firstLine}`)
      }
      throw this.classifyError(firstLine, args, cwd, err)
    }
  }

  private normalizeArgs(args: string[], options: GitRunOptions): string[] {
    const result = ['--no-pager', '-c', 'core.quotepath=false', ...args]

    // Insert diff-specific flags immediately after the 'diff' subcommand.
    if (args[0] === 'diff') {
      if (options.renames === false) {
        result.splice(4, 0, '--no-ext-diff')
      } else {
        result.splice(4, 0, '--no-ext-diff', '--no-renames')
      }
    }

    return result
  }

  private classifyError(message: string, args: string[], cwd: string, original: unknown): GitError {
    const lower = message.toLowerCase()
    const originalErr = original as { exitCode?: number; stdout?: string }
    let code: GitErrorCode
    if (lower.includes('not a git repository')) {
      code = 'NOT_A_GIT_REPO'
    } else if (lower.includes('nothing to commit')) {
      code = 'NOTHING_TO_COMMIT'
    } else if (lower.includes('merge conflict') || lower.includes('conflict')) {
      code = 'MERGE_CONFLICT'
    } else if (lower.includes('could not resolve host') || lower.includes('failed to connect')) {
      code = 'NETWORK_ERROR'
    } else if (lower.includes('authentication failed') || lower.includes('could not read username')) {
      code = 'AUTHENTICATION_FAILED'
    } else if (lower.includes('unable to create') && lower.includes('lock file')) {
      code = 'LOCKED'
    } else if (
      lower.includes('does not appear to be a git repository') ||
      lower.includes('no such remote') ||
      lower.includes('could not read from remote repository') ||
      lower.includes('no remote repository specified')
    ) {
      code = 'NO_REMOTE'
    } else if (lower.includes('no tracking information') || lower.includes('no upstream branch')) {
      code = 'NO_UPSTREAM'
    } else {
      code = 'UNKNOWN'
    }
    return new GitError(message, code, args, cwd, originalErr.exitCode, originalErr.stdout)
  }
}
