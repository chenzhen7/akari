import { watch, type FSWatcher } from 'chokidar'
import { join, relative, resolve } from 'node:path'
import type { GitDiff, DiffFile, GitCommit, GitBranch, GitLogResponse, FileDiffLine } from '@akari/shared-types'
import { GitCommandRunner } from './git-command-runner.js'
import { loadGitignoreFilter } from '../fs/gitignore-loader.js'
import { perfLog, perfNow } from '../../perf-log.js'

interface WatchDiffCallbacks {
  onDiff: (diff: GitDiff) => void
  onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
}

/**
 * Represents a single Git repository (main repo or a worktree).
 *
 * Responsibilities:
 * - Execute git commands in its own root via GitCommandRunner.
 * - Cache HEAD, current branch, and diff results.
 * - Watch working tree files and git metadata to invalidate caches.
 */
export class GitRepository {
  private head: string | undefined
  private branch: string | undefined
  private diff: GitDiff | undefined
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
      const result = await this.runner.run(['rev-parse', '--abbrev-ref', 'HEAD'], this.repoPath)
      this.branch = result.trim()
      return this.branch
    } catch {
      return 'main'
    }
  }

  private async resolveHead(): Promise<string> {
    if (this.head !== undefined) return this.head
    try {
      const result = await this.runner.run(['rev-parse', 'HEAD'], this.repoPath)
      this.head = result.trim()
      return this.head
    } catch {
      return ''
    }
  }

  async getGitLog(limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    const emptyLog: GitLogResponse = { commits: [], branches: [], head: '' }
    try {
      const sep = '||'
      const fmt = `%H${sep}%h${sep}%s${sep}%an${sep}%ae${sep}%aI${sep}%P${sep}%D`
      const logArgs = branch
        ? ['log', branch, '--topo-order', `--skip=${offset}`, `--max-count=${limit}`, `--format=${fmt}`]
        : ['log', '--all', '--topo-order', `--skip=${offset}`, `--max-count=${limit}`, `--format=${fmt}`]
      const raw = await this.runner.run(logArgs, this.repoPath)
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

      const head = await this.resolveHead()
      const branches = await this.getGitBranches()
      return { commits, branches, head }
    } catch {
      return emptyLog
    }
  }

  async getGitBranches(): Promise<GitBranch[]> {
    try {
      const raw = await this.runner.run(
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
      const raw = await this.runner.run(['branch', '--format=%(refname:short)|%(HEAD)'], this.repoPath)
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

  async getDiff(): Promise<GitDiff> {
    if (this.diff !== undefined) return this.diff
    const diff = await this.computeDiff()
    this.diff = diff
    return diff
  }

  private async computeDiff(): Promise<GitDiff> {
    const emptyDiff: GitDiff = { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    const t0 = perfNow()
    try {
      const baseRef = 'HEAD'

      const [stat, full, nameStatus, numStat] = await Promise.all([
        this.runner.run(['diff', '--stat', baseRef], this.repoPath),
        this.runner.run(['diff', baseRef], this.repoPath),
        this.runner.run(['diff', '--name-status', baseRef], this.repoPath),
        this.runner.run(['diff', '--numstat', baseRef], this.repoPath),
      ])

      const numStatMap = parseNumStat(numStat)

      const untrackedRaw = await this.runner
        .run(['ls-files', '--others', '--exclude-standard', '--full-name'], this.repoPath)
        .catch(() => '')
      const untrackedFiles = untrackedRaw.trim() ? untrackedRaw.trim().split('\n').filter(Boolean) : []
      console.log(`[Perf] [computeDiff] untracked 文件数=${untrackedFiles.length}（每个都要单独跑 git diff --no-index）@ ${this.repoPath}`)

      let extraDiff = ''
      const extraFiles: DiffFile[] = []
      for (const file of untrackedFiles) {
        const fileDiff = await this.runner
          .run(['diff', '--no-index', '--', '/dev/null', file], this.repoPath)
          .catch((e: unknown) => {
            const err = e as { exitCode?: number; stdout?: string }
            return err.exitCode === 1 ? (err.stdout ?? '') : ''
          })
        if (fileDiff) {
          extraDiff += fileDiff + '\n'
          const added = fileDiff.split('\n').filter((l: string) => l.startsWith('+') && !l.startsWith('+++')).length
          extraFiles.push({ path: file, status: 'A', additions: added, deletions: 0 })
        }
      }

      const trackedFiles = parseFileStatus(nameStatus).map(f => ({
        ...f,
        additions: numStatMap.get(f.path)?.additions ?? 0,
        deletions: numStatMap.get(f.path)?.deletions ?? 0,
      }))

      return {
        stat,
        fullDiff: full + extraDiff,
        files: [...trackedFiles, ...extraFiles],
        summary: parseStat(stat),
      }
    } catch {
      return emptyDiff
    } finally {
      perfLog(`[computeDiff] 总耗时 @ ${this.repoPath}`, t0)
    }
  }

  async getFileDiffContent(filePath: string): Promise<{ original: string }> {
    const original = await this.runner.run(['show', `HEAD:${filePath}`], this.repoPath).catch(() => '')
    return { original }
  }

  async getFileDiffLines(filePath: string): Promise<FileDiffLine[]> {
    const t0 = perfNow()
    try {
      const headDiff = await this.runner
        .run(['diff', '--unified=0', 'HEAD', '--', filePath], this.repoPath)
        .catch(() => '')

      if (headDiff) return parseDiffLines(headDiff)

      const existsInHead = await this.runner
        .run(['cat-file', '-e', `HEAD:${filePath}`], this.repoPath)
        .then(() => true)
        .catch(() => false)

      if (existsInHead) return []

      const untrackedDiff = await this.runner
        .run(['diff', '--no-index', '--unified=0', '--', '/dev/null', filePath], this.repoPath)
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

  async commitAll(message: string): Promise<void> {
    await this.runner.run(['add', '-A'], this.repoPath)
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

  async discardFile(filePath: string): Promise<void> {
    await this.runner.run(['checkout', '--', filePath], this.repoPath)
    await this.runner.run(['clean', '-fd', '--', filePath], this.repoPath)
    this.invalidateDiffCache()
  }

  watchDiff(callbacks: WatchDiffCallbacks): FSWatcher {
    const tWatch = perfNow()

    // Hard-coded exclusions for common large/generated directories that are
    // almost never relevant for diff updates. These are checked first (fast
    // regex) before falling back to the repository's .gitignore rules.
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

    let debounce: ReturnType<typeof setTimeout> | null = null
    const scheduleDiff = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void this.getDiff().then(callbacks.onDiff)
      }, 500)
    }

    const handleChange = (absolutePath: string, changeType: 'add' | 'change' | 'unlink') => {
      const relativePath = relative(this.repoPath, absolutePath).replace(/\\/g, '/')
      if (!relativePath || relativePath.startsWith('..')) return
      callbacks.onFileChange?.(relativePath, changeType)
      this.invalidateDiffCache()
      scheduleDiff()
    }

    watcher
      .on('add', (path) => handleChange(path, 'add'))
      .on('change', (path) => handleChange(path, 'change'))
      .on('unlink', (path) => handleChange(path, 'unlink'))

    const tDiff = perfNow()
    void this.getDiff().then(diff => {
      perfLog(`[watchDiff] 启动时首次 getDiff @ ${this.repoPath}`, tDiff)
      callbacks.onDiff(diff)
    })

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
    const gitDirRaw = (await this.runner.run(['rev-parse', '--git-dir'], this.repoPath)).trim()
    const gitDir = resolve(this.repoPath, gitDirRaw)
    const commonRaw = await this.runner
      .run(['rev-parse', '--git-common-dir'], this.repoPath)
      .then(r => r.trim())
      .catch(() => null)
    const commonDir = commonRaw ? resolve(this.repoPath, commonRaw) : gitDir
    return { gitDir, commonDir }
  }

  invalidateDiffCache(): void {
    this.diff = undefined
  }

  invalidateRepoCache(): void {
    this.head = undefined
    this.branch = undefined
    this.diff = undefined
  }

  async dispose(): Promise<void> {
    await this.diffWatcher?.close()
    await this.metadataWatcher?.close()
  }
}

function parseFileStatus(output: string): DiffFile[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .flatMap(line => {
      const parts = line.split('\t')
      if (parts.length < 2) return []
      const char = parts[0].charAt(0)
      const validStatuses = new Set(['A', 'M', 'D', 'R'])
      const status = validStatuses.has(char) ? (char as DiffFile['status']) : 'M'
      const path = parts[1] ?? ''
      if (!path) return []
      return [{ path, status, additions: 0, deletions: 0 }]
    })
}

function parseNumStat(output: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  if (!output.trim()) return map
  for (const line of output.trim().split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const additions = parseInt(parts[0] ?? '0') || 0
    const deletions = parseInt(parts[1] ?? '0') || 0
    const path = parts.slice(2).join('\t')
    if (path) map.set(path, { additions, deletions })
  }
  return map
}

function parseStat(stat: string): { additions: number; deletions: number; files: number } {
  if (!stat.trim()) return { additions: 0, deletions: 0, files: 0 }
  return {
    files: parseInt(stat.match(/(\d+) file/)?.[1] ?? '0'),
    additions: parseInt(stat.match(/(\d+) insertion/)?.[1] ?? '0'),
    deletions: parseInt(stat.match(/(\d+) deletion/)?.[1] ?? '0'),
  }
}

function parseDiffLines(diffOutput: string): FileDiffLine[] {
  const lines: FileDiffLine[] = []
  const diffLines = diffOutput.split('\n')
  let i = 0

  while (i < diffLines.length) {
    const line = diffLines[i]
    if (!line.startsWith('@@')) {
      i++
      continue
    }

    const match = line.match(/@@ -(\d+)(?::(\d+))? \+(\d+)(?::(\d+))? @@/)
    if (!match) {
      i++
      continue
    }

    const oldStart = parseInt(match[1]!)
    const oldCount = parseInt(match[2] ?? '1')
    const newStart = parseInt(match[3]!)
    const newCount = parseInt(match[4] ?? '1')

    let oldLine = oldStart
    let newLine = newStart
    i++

    const hunkMinusLines: number[] = []
    const hunkPlusLines: number[] = []

    while (i < diffLines.length && !diffLines[i]!.startsWith('@@') && !diffLines[i]!.startsWith('diff --git')) {
      const dline = diffLines[i]!
      if (dline.startsWith(' ')) {
        oldLine++
        newLine++
      } else if (dline.startsWith('+')) {
        hunkPlusLines.push(newLine)
        newLine++
      } else if (dline.startsWith('-')) {
        hunkMinusLines.push(oldLine)
        oldLine++
      }
      i++
    }

    if (hunkMinusLines.length > 0 && hunkPlusLines.length > 0) {
      const pairCount = Math.min(hunkMinusLines.length, hunkPlusLines.length)
      for (let j = 0; j < pairCount; j++) {
        lines.push({ type: 'modified', lineNumber: hunkPlusLines[j]! })
      }
      for (let j = pairCount; j < hunkPlusLines.length; j++) {
        lines.push({ type: 'added', lineNumber: hunkPlusLines[j]! })
      }
      if (hunkPlusLines.length > 0) {
        for (let j = pairCount; j < hunkMinusLines.length; j++) {
          lines.push({ type: 'removed', lineNumber: hunkPlusLines[0]! })
        }
      } else {
        for (let j = 0; j < hunkMinusLines.length; j++) {
          lines.push({ type: 'removed', lineNumber: newStart })
        }
      }
    } else if (hunkPlusLines.length > 0) {
      for (const ln of hunkPlusLines) {
        lines.push({ type: 'added', lineNumber: ln })
      }
    } else if (hunkMinusLines.length > 0) {
      for (let j = 0; j < hunkMinusLines.length; j++) {
        lines.push({ type: 'removed', lineNumber: newStart })
      }
    }
  }

  return lines
}
