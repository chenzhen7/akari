import { watch, type FSWatcher } from 'chokidar'
import { join, relative, resolve } from 'node:path'
import { open, stat as fsStat } from 'node:fs/promises'
import type { GitDiff, DiffFile, DiffHunk, GitCommit, GitBranch, GitLogResponse, FileDiffLine } from '@akari/shared-types'
import { GitCommandRunner } from './git-command-runner.js'
import { loadGitignoreFilter } from '../fs/gitignore-loader.js'
import { parseDiffHunks, parseDiffLines } from './diff-parser.js'
import { perfLog, perfNow } from '../../perf-log.js'

interface WatchDiffCallbacks {
  /** 工作树文件变化（add/change/unlink）→ 由上层防抖后刷新变更列表 */
  onChanged: () => void
  onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
}

/** porcelain v1 -z 单条记录：`XY path`（rename 时后续还有一条 newPath） */
interface PorcelainEntry {
  x: string
  y: string
  path: string
  oldPath?: string
}

/** 变更列表截断上限（对齐 VSCode statusLimit 思路：超限只取前 N，标记 truncated） */
const MAX_CHANGE_FILES = 20000
/** 未跟踪文件行数统计的并发上限 */
const UNTRACKED_PARALLEL = 8
/** 未跟踪文件大小上限：超过视为大文件/二进制，不做行数统计 */
const MAX_UNTRACKED_FILE_SIZE = 8 * 1024 * 1024

/**
 * Represents a single Git repository (main repo or a worktree).
 *
 * Responsibilities:
 * - Execute git commands in its own root via GitCommandRunner.
 * - Cache HEAD, current branch, change list, and git log (short TTL).
 * - Watch working tree files and git metadata to invalidate caches.
 *
 * 变更列表（getDiff）改用 `git status --porcelain=v1 -z -uall` + `git diff --numstat -z HEAD`
 * 两条只读命令一次拿全（原 computeDiff 要 4 条 diff + 每个未跟踪文件一条 `--no-index`），
 * 未跟踪文件的行数用纯 fs 数行、不 spawn git。
 */
export class GitRepository {
  private head: string | undefined
  private branch: string | undefined
  private diff: GitDiff | undefined
  private readonly gitLogCache = new Map<string, { data: GitLogResponse; at: number }>()
  private readonly GIT_LOG_TTL_MS = 1500
  private diffWatcher: FSWatcher | null = null
  private metadataWatcher: FSWatcher | null = null

  constructor(
    private readonly repoPath: string,
    private readonly runner: GitCommandRunner,
  ) {}

  get path(): string {
    return this.repoPath
  }

  async getCurrentBranch(): Promise<string> {
    if (this.branch !== undefined) return this.branch
    try {
      const result = await this.runner.runRead(['rev-parse', '--abbrev-ref', 'HEAD'], this.repoPath)
      this.branch = result.trim()
      return this.branch
    } catch {
      return 'main'
    }
  }

  private async resolveHead(): Promise<string> {
    if (this.head !== undefined) return this.head
    try {
      const result = await this.runner.runRead(['rev-parse', 'HEAD'], this.repoPath)
      this.head = result.trim()
      return this.head
    } catch {
      return ''
    }
  }

  async getGitLog(limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    const cacheKey = `${branch ?? ''}|${limit}|${offset}`
    const cached = this.gitLogCache.get(cacheKey)
    if (cached && perfNow() - cached.at < this.GIT_LOG_TTL_MS) {
      return cached.data
    }

    const emptyLog: GitLogResponse = { commits: [], branches: [], head: '' }
    try {
      const sep = '||'
      const fmt = `%H${sep}%h${sep}%s${sep}%an${sep}%ae${sep}%aI${sep}%P${sep}%D`
      const logArgs = branch
        ? ['log', branch, '--topo-order', `--skip=${offset}`, `--max-count=${limit}`, `--format=${fmt}`]
        : ['log', '--all', '--topo-order', `--skip=${offset}`, `--max-count=${limit}`, `--format=${fmt}`]

      // 三条只读命令走读池，真并行（原实现串行 await）
      const [raw, head, branches] = await Promise.all([
        this.runner.runRead(logArgs, this.repoPath),
        this.resolveHead(),
        this.getGitBranches(),
      ])

      const commits: GitCommit[] = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split(sep)
          const hash = parts[0] ?? ''
          const shortHash = parts[1] ?? ''
          const message = parts[2] ?? ''
          const author = parts[3] ?? ''
          const email = parts[4] ?? ''
          const date = parts[5] ?? ''
          const parents = (parts[6] ?? '').trim() ? (parts[6] ?? '').trim().split(' ') : []
          const decorations = parts[7] ?? ''
          const refs = decorations
            .split(',')
            .map(r => r.trim())
            .filter(r => r && r !== 'HEAD')
            .map(r => r.replace(/^HEAD -> /, ''))
          return { hash, shortHash, message, author, email, date, parents, refs }
        })

      const data: GitLogResponse = { commits, branches, head }
      this.gitLogCache.set(cacheKey, { data, at: perfNow() })
      return data
    } catch {
      return emptyLog
    }
  }

  async getGitBranches(): Promise<GitBranch[]> {
    try {
      const raw = await this.runner.runRead(
        ['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(HEAD)'],
        this.repoPath,
      )
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|')
          const name = (parts[0] ?? '').trim()
          const commit = (parts[1] ?? '').trim()
          const isCurrent = (parts[2] ?? '').trim() === '*'
          const isRemote = name.startsWith('remotes/') || name.startsWith('origin/')
          return { name: name.replace(/^remotes\//, ''), commit, isCurrent, isRemote }
        })
        .filter(b => b.name && b.name !== 'HEAD')
    } catch {
      return []
    }
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    try {
      const raw = await this.runner.runRead(['branch', '--format=%(refname:short)|%(HEAD)'], this.repoPath)
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|')
          const name = (parts[0] ?? '').trim()
          const isCurrent = (parts[1] ?? '').trim() === '*'
          return { name, isCurrent }
        })
        .filter(b => b.name)
    } catch {
      return []
    }
  }

  /** 变更列表（含未跟踪文件）。缓存命中直接返回。 */
  async getDiff(): Promise<GitDiff> {
    if (this.diff !== undefined) return this.diff
    const diff = await this.computeChangeList()
    this.diff = diff
    return diff
  }

  /**
   * 两条只读命令拿全量变更列表：
   *   git status --porcelain=v1 -z -uall   → 文件清单 + 状态位（含未跟踪、rename）
   *   git diff --numstat -z HEAD          → 已跟踪文件的 +/- 行数（runner 恒注入 --no-renames，
   *                                          故 rename 表现为 D+A 两条独立记录，确定性好）
   * 未跟踪文件的行数用 fs 流式数行（不 spawn git），二进制/超大文件返回 0。
   */
  private async computeChangeList(): Promise<GitDiff> {
    const emptyDiff: GitDiff = { files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    const t0 = perfNow()
    try {
      const [statusRaw, numstatRaw] = await Promise.all([
        this.runner.runRead(['status', '--porcelain=v1', '-z', '-uall', '--'], this.repoPath),
        // unborn HEAD（尚无首次提交）时 git diff HEAD 必然失败；此时无已跟踪文件，
        // 全部条目都是未跟踪（status 'A'），numstat 无意义，降级为空即可继续。
        this.runner.runRead(['diff', '--numstat', '-z', 'HEAD', '--'], this.repoPath).catch(() => ''),
      ])

      const entries = parsePorcelainV1Z(statusRaw)
      const numstat = parseNumstatZ(numstatRaw)

      const files: DiffFile[] = []
      const untrackedJobs: Array<{ index: number; path: string }> = []
      let truncated = false

      for (const entry of entries) {
        if (files.length >= MAX_CHANGE_FILES) {
          truncated = true
          break
        }
        if (entry.x === '?' || entry.y === '?') {
          untrackedJobs.push({ index: files.length, path: entry.path })
          files.push({ path: entry.path, status: 'A', additions: 0, deletions: 0 })
          continue
        }
        const status = mapStatus(entry)
        const additions = numstat.get(entry.path)?.additions ?? 0
        const deletions =
          (status === 'R' ? numstat.get(entry.oldPath ?? '')?.deletions : numstat.get(entry.path)?.deletions) ?? 0
        files.push({ path: entry.path, status, additions, deletions })
      }

      // 有界并行统计未跟踪文件行数
      let cursor = 0
      await Promise.all(
        Array.from({ length: Math.min(UNTRACKED_PARALLEL, untrackedJobs.length) }, async () => {
          for (;;) {
            const job = untrackedJobs[cursor]
            if (!job) return
            cursor++
            const n = await this.countUntrackedLines(job.path)
            files[job.index]!.additions = n
          }
        }),
      )

      let additions = 0
      let deletions = 0
      for (const f of files) {
        additions += f.additions
        deletions += f.deletions
      }

      const result: GitDiff = { files, summary: { additions, deletions, files: files.length } }
      if (truncated) result.truncated = true
      return result
    } catch {
      return emptyDiff
    } finally {
      perfLog(`[computeChangeList] 总耗时 @ ${this.repoPath}`, t0)
    }
  }

  private async countUntrackedLines(relPath: string): Promise<number> {
    return countLinesOfFile(resolve(this.repoPath, relPath))
  }

  async getFileDiffContent(filePath: string): Promise<{ original: string }> {
    const original = await this.runner.runRead(['show', `HEAD:${filePath}`], this.repoPath).catch(() => '')
    return { original }
  }

  async getFileDiffLines(filePath: string): Promise<FileDiffLine[]> {
    const t0 = perfNow()
    try {
      const headDiff = await this.runner
        .runRead(['diff', '--unified=0', 'HEAD', '--', filePath], this.repoPath)
        .catch(() => '')

      if (headDiff) return parseDiffLines(headDiff)

      const existsInHead = await this.runner
        .runRead(['cat-file', '-e', `HEAD:${filePath}`], this.repoPath)
        .then(() => true)
        .catch(() => false)

      if (existsInHead) return []

      const untrackedDiff = await this.runner
        .runRead(['diff', '--no-index', '--unified=0', '--', '/dev/null', filePath], this.repoPath)
        .catch((e: unknown) => {
          const err = e as { exitCode?: number; stdout?: string }
          return err.exitCode === 1 ? (err.stdout ?? '') : ''
        })

      if (!untrackedDiff) return []
      return parseDiffLines(untrackedDiff)
    } finally {
      perfLog(`[getFileDiffLines] ${filePath} @ ${this.repoPath}`, t0)
    }
  }

  async getFileDiffHunks(filePath: string): Promise<DiffHunk[]> {
    const t0 = perfNow()
    try {
      const headDiff = await this.runner
        .runRead(['diff', '-U6', 'HEAD', '--', filePath], this.repoPath)
        .catch(() => '')

      if (headDiff) return parseDiffHunks(headDiff)

      const existsInHead = await this.runner
        .runRead(['cat-file', '-e', `HEAD:${filePath}`], this.repoPath)
        .then(() => true)
        .catch(() => false)

      if (existsInHead) return []

      const untrackedDiff = await this.runner
        .runRead(['diff', '-U6', '--no-index', '--', '/dev/null', filePath], this.repoPath)
        .catch((e: unknown) => {
          const err = e as { exitCode?: number; stdout?: string }
          return err.exitCode === 1 ? (err.stdout ?? '') : ''
        })

      if (!untrackedDiff) return []
      return parseDiffHunks(untrackedDiff)
    } finally {
      perfLog(`[getFileDiffHunks] ${filePath} @ ${this.repoPath}`, t0)
    }
  }

  async commitAll(message: string): Promise<void> {
    await this.runner.run(['add', '-A'], this.repoPath)
    await this.runner.run(['commit', '-m', message], this.repoPath)
    this.invalidateRepoCache()
  }

  async commitFiles(message: string, filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) throw new Error('no files to commit')
    await this.runner.run(['add', '--', ...filePaths], this.repoPath)
    await this.runner.run(['commit', '-m', message], this.repoPath)
    this.invalidateRepoCache()
  }

  async discardAll(): Promise<void> {
    await this.runner.run(['checkout', '--', '.'], this.repoPath)
    await this.runner.run(['clean', '-fd'], this.repoPath)
    this.invalidateRepoCache()
  }

  async checkoutBranch(branch: string, createNew = false): Promise<void> {
    if (createNew) {
      await this.runner.run(['checkout', '-b', branch], this.repoPath)
    } else {
      await this.runner.run(['checkout', branch], this.repoPath)
    }
    this.invalidateRepoCache()
  }

  async mergeIntoCurrentBranch(
    sourceBranch: string,
    strategy: 'squash' | 'merge' | 'rebase' = 'squash',
  ): Promise<void> {
    const currentBranch = await this.getCurrentBranch()
    if (strategy === 'squash') {
      await this.runner.run(['merge', '--squash', sourceBranch], this.repoPath)
      await this.runner.run(
        ['commit', '-m', `chore: squash merge ${sourceBranch} into ${currentBranch}`],
        this.repoPath,
      )
    } else if (strategy === 'merge') {
      await this.runner.run(
        ['merge', '--no-ff', '-m', `Merge ${sourceBranch} into ${currentBranch}`, sourceBranch],
        this.repoPath,
      )
    } else {
      await this.runner.run(['rebase', sourceBranch], this.repoPath)
    }
    this.invalidateRepoCache()
  }

  async updateFromBase(sourceBranch: string): Promise<void> {
    await this.runner.run(
      ['merge', '--no-ff', '-m', `Merge ${sourceBranch} into current branch`, sourceBranch],
      this.repoPath,
    )
    this.invalidateRepoCache()
  }

  /**
   * 主会话「更新」：仅快进拉取。本地与远程分叉时 git 直接报错且不改动仓库，
   * 不会留下 MERGE_HEAD 冲突中间态。
   */
  async pullMain(): Promise<void> {
    await this.runner.run(['pull', '--ff-only'], this.repoPath, { timeout: 120000 })
    this.invalidateRepoCache()
  }

  /**
   * 主会话「推送」：推送当前分支到 origin，无上游时自动设置（-u），永不 force。
   * 返回是否已是最新（git 输出 "Everything up-to-date"）。
   */
  async pushMain(): Promise<{ upToDate: boolean }> {
    const stdout = await this.runner.run(['push', '-u', 'origin', 'HEAD'], this.repoPath, { timeout: 120000 })
    this.invalidateRepoCache()
    return { upToDate: /everything up-to-date/i.test(stdout) }
  }

  async discardFile(filePath: string): Promise<void> {
    await this.runner.run(['checkout', '--', filePath], this.repoPath)
    await this.runner.run(['clean', '-fd', '--', filePath], this.repoPath)
    this.invalidateDiffCache()
  }

  /**
   * 回滚 line 所在的变更块（hunk）到 HEAD 版本：重建该 hunk 的补丁并 `git apply -R`
   * 反向应用，只还原这一处改动、保留文件其他改动（对应 VSCode 的 revertChange）。
   * 未跟踪文件（无 HEAD 版本可回滚）与找不到对应 hunk 时抛错。
   */
  async revertChange(filePath: string, line: number): Promise<void> {
    const existsInHead = await this.runner
      .runRead(['cat-file', '-e', `HEAD:${filePath}`], this.repoPath)
      .then(() => true)
      .catch(() => false)
    if (!existsInHead) throw new Error('未跟踪文件暂不支持回滚变更')

    const hunks = await this.getFileDiffHunks(filePath)
    const hunk = hunks.find((h) =>
      h.newCount > 0 ? line >= h.newStart && line < h.newStart + h.newCount : line === h.newStart,
    )
    if (!hunk) throw new Error(`未找到行 ${line} 对应的变更块`)

    const patch = this.buildHunkPatch(filePath, hunk)
    await this.runner.run(['apply', '-R', '-'], this.repoPath, { input: patch })
    this.invalidateDiffCache()
  }

  /** 从解析出的 hunk 重建可被 `git apply` 消费的补丁文本（`+newStart` 已是当前工作树行号）。 */
  private buildHunkPatch(filePath: string, hunk: DiffHunk): string {
    const count = (n: number): string => (n === 1 ? '' : `,${n}`)
    const header = `@@ -${hunk.oldStart}${count(hunk.oldCount)} +${hunk.newStart}${count(hunk.newCount)} @@${hunk.header}`
    const body = hunk.lines
      .map((l) => `${l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}${l.content}`)
      .join('\n')
    return `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n${header}\n${body}\n`
  }

  /**
   * Watch working tree files. On any change we invalidate the change-list cache and
   * emit `onChanged`; debounce/refresh scheduling lives in the coordinator (上层).
   */
  watchDiff(callbacks: WatchDiffCallbacks): FSWatcher {
    const tWatch = perfNow()

    const defaultIgnored = /(^|[\\/])(node_modules|\.git|\.idea|\.vscode|\.cache|dist|build|out|target|coverage|\.next|\.nuxt|tmp|logs?|\.agent-worktrees)([\\/]|$)/i
    const gitignore = loadGitignoreFilter(this.repoPath)

    const ignored = (filePath: string): boolean => {
      if (defaultIgnored.test(filePath)) return true
      const relativePath = relative(this.repoPath, filePath).replace(/\\/g, '/')
      if (!relativePath) return false
      return gitignore.ignores(relativePath)
    }

    const watcher = watch(this.repoPath, {
      ignored,
      persistent: true,
      ignoreInitial: true,
    })
    this.diffWatcher = watcher

    watcher.on('ready', () => {
      perfLog(`[chokidar] 初始扫描完成（watch → ready）@ ${this.repoPath}`, tWatch)
    })

    const handleChange = (absolutePath: string, changeType: 'add' | 'change' | 'unlink') => {
      const relativePath = relative(this.repoPath, absolutePath).replace(/\\/g, '/')
      if (!relativePath || relativePath.startsWith('..')) return
      callbacks.onFileChange?.(relativePath, changeType)
      this.invalidateDiffCache()
      callbacks.onChanged()
    }

    watcher
      .on('add', (path) => handleChange(path, 'add'))
      .on('change', (path) => handleChange(path, 'change'))
      .on('unlink', (path) => handleChange(path, 'unlink'))

    return watcher
  }

  /**
   * Watch git metadata (HEAD / index / refs) so that git operations performed
   * OUTSIDE the app (external commit / push / checkout) also invalidate caches.
   *
   * 通过 `git rev-parse --git-dir` / `--git-common-dir` 解析真实 gitdir，
   * 兼容 worktree（其 `.git` 是指针文件，真实 gitdir 在主仓库 `.git/worktrees/` 下，
   * 而 refs 位于 commonDir）。
   */
  async watchGitMetadata(callback: () => void): Promise<FSWatcher | null> {
    try {
      const { gitDir, commonDir } = await this.resolveGitDirs()
      const paths = [
        join(gitDir, 'HEAD'),
        join(gitDir, 'index'),
        join(commonDir, 'refs'),
        join(commonDir, 'packed-refs'),
      ]
      const watcher = watch(paths, { persistent: true, ignoreInitial: true })
      this.metadataWatcher = watcher
      let debounce: ReturnType<typeof setTimeout> | null = null
      const scheduleCallback = () => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          this.invalidateRepoCache()
          callback()
        }, 300)
      }
      watcher
        .on('change', scheduleCallback)
        .on('add', scheduleCallback)
        .on('unlink', scheduleCallback)
      return watcher
    } catch (err) {
      console.warn(`[GitRepository] failed to watch git metadata for ${this.repoPath}:`, err)
      return null
    }
  }

  private async resolveGitDirs(): Promise<{ gitDir: string; commonDir: string }> {
    const gitDirRaw = (await this.runner.runRead(['rev-parse', '--git-dir'], this.repoPath)).trim()
    const gitDir = resolve(this.repoPath, gitDirRaw)
    const commonRaw = await this.runner
      .runRead(['rev-parse', '--git-common-dir'], this.repoPath)
      .then(r => r.trim())
      .catch(() => null)
    const commonDir = commonRaw ? resolve(this.repoPath, commonRaw) : gitDir
    return { gitDir, commonDir }
  }

  invalidateDiffCache(): void {
    this.diff = undefined
  }

  invalidateGitLogCache(): void {
    this.gitLogCache.clear()
  }

  invalidateRepoCache(): void {
    this.head = undefined
    this.branch = undefined
    this.diff = undefined
    this.gitLogCache.clear()
  }

  async dispose(): Promise<void> {
    await this.diffWatcher?.close()
    await this.metadataWatcher?.close()
  }
}

/** 解析 `git status --porcelain=v1 -z` 输出为结构化条目（含 rename 双 token）。 */
function parsePorcelainV1Z(raw: string): PorcelainEntry[] {
  const tokens = raw.split('\0')
  const entries: PorcelainEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    i++
    if (token.length < 4) continue // 至少 "XY x"
    const x = token.charAt(0)
    const y = token.charAt(1)
    let path = token.slice(3)
    let oldPath: string | undefined
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      // rename/copy：`--porcelain=v1 -z` 下首条记录的 path 是「新路径」，
      // 紧随其后的 NUL 记录是「旧路径」（实测 `git status -z` 输出顺序）
      oldPath = tokens[i] ?? ''
      i++
    }
    if (!path || path.endsWith('/')) continue // 嵌套 git 仓库以 / 结尾，跳过
    entries.push({ x, y, path, oldPath })
  }
  return entries
}

/** 解析 `git diff --numstat -z HEAD` 输出（--no-renames 下无 rename 双路径记录）。 */
function parseNumstatZ(raw: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  for (const token of raw.split('\0')) {
    if (!token) continue
    const parts = token.split('\t')
    if (parts.length < 3) continue
    const additions = parseInt(parts[0] ?? '', 10)
    const deletions = parseInt(parts[1] ?? '', 10)
    const path = parts.slice(2).join('\t')
    if (!path) continue
    map.set(path, {
      additions: Number.isNaN(additions) ? 0 : additions,
      deletions: Number.isNaN(deletions) ? 0 : deletions,
    })
  }
  return map
}

/** porcelain 的 XY 双状态位 → DiffFile.status（rename/copy 优先，其次 D/A，默认 M）。 */
function mapStatus(entry: PorcelainEntry): DiffFile['status'] {
  if (entry.x === 'R' || entry.x === 'C' || entry.y === 'R' || entry.y === 'C') return 'R'
  if (entry.x === 'D' || entry.y === 'D') return 'D'
  if (entry.x === 'A' || entry.y === 'A') return 'A'
  return 'M'
}

/**
 * 数一个文件的文本行数（对齐 git numstat：`\n` 计数 + 无尾换行时 +1）。
 * 二进制（首 8KB 含 NUL）或超大文件返回 0，避免把图片/压缩包计入 diff 行数。
 */
async function countLinesOfFile(absolutePath: string): Promise<number> {
  try {
    const fileStat = await fsStat(absolutePath)
    if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > MAX_UNTRACKED_FILE_SIZE) return 0

    const handle = await open(absolutePath, 'r')
    try {
      const probe = Buffer.alloc(Math.min(8192, fileStat.size))
      await handle.read(probe, 0, probe.length, 0)
      if (probe.includes(0)) return 0 // 二进制

      const chunk = Buffer.alloc(64 * 1024)
      let newlines = 0
      let totalBytes = 0
      let lastByteWasNewline = false
      let position = 0
      while (position < fileStat.size) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
        if (bytesRead === 0) break
        for (let i = 0; i < bytesRead; i++) {
          if (chunk[i] === 0x0a) newlines++
        }
        lastByteWasNewline = chunk[bytesRead - 1] === 0x0a
        totalBytes += bytesRead
        position += bytesRead
      }
      return newlines + (totalBytes > 0 && !lastByteWasNewline ? 1 : 0)
    } finally {
      await handle.close()
    }
  } catch {
    return 0
  }
}
