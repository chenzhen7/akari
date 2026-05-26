import { execa } from 'execa'
import { watch, type FSWatcher } from 'chokidar'
import { mkdir, symlink, rm, access, constants, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GitDiff, DiffFile, GitCommit, GitBranch, GitLogResponse } from '@akari/shared-types'

export class WorktreeManager {
  private readonly baseRepoPath: string
  private readonly worktreeBaseDir: string
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(repoPath: string) {
    this.baseRepoPath = resolve(repoPath)
    this.worktreeBaseDir = join(this.baseRepoPath, '.agent-worktrees')
  }

  async createWorktree(
    sessionId: string,
    taskName: string,
    baseBranch = 'main',
  ): Promise<{ branchName: string; worktreePath: string; resolvedBase: string }> {
    const safeName = taskName
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase()
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
    const branchName = `agent/${safeName}-${sessionId.slice(0, 8)}`
    const worktreePath = this.getWorktreePath(sessionId)

    await mkdir(this.worktreeBaseDir, { recursive: true })

    // Resolve base branch — fall back to current HEAD if requested branch doesn't exist
    let resolvedBase = baseBranch
    try {
      await this.git(['rev-parse', '--verify', baseBranch])
    } catch {
      resolvedBase = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    }

    await this.git(['worktree', 'add', '-b', branchName, worktreePath, resolvedBase])
    await this.linkNodeModules(worktreePath)

    return { branchName, worktreePath, resolvedBase }
  }

  async removeWorktree(sessionId: string, branchName?: string): Promise<void> {
    const watcher = this.watchers.get(sessionId)
    if (watcher) {
      await watcher.close()
      this.watchers.delete(sessionId)
    }
    const worktreePath = this.getWorktreePath(sessionId)
    try {
      await this.git(['worktree', 'remove', '--force', worktreePath])
    } catch {
      await rm(worktreePath, { recursive: true, force: true }).catch(() => {})
    }
    await this.git(['worktree', 'prune']).catch(() => {})
    if (branchName) {
      await this.git(['branch', '-D', branchName]).catch(() => {})
    }
  }

  async getDiff(sessionId: string, baseBranch: string): Promise<GitDiff> {
    const cwd = this.getWorktreePath(sessionId)
    try {
      // Use merge-base so the diff only reflects agent branch changes,
      // not new commits that may have landed on baseBranch since the worktree was created.
      const mergeBase = (await this.git(['merge-base', 'HEAD', baseBranch], cwd).catch(() => '')).trim()
      const baseRef = mergeBase || baseBranch

      const [stat, full, nameStatus, numStat] = await Promise.all([
        this.git(['diff', '--stat', baseRef], cwd),
        this.git(['diff', baseRef], cwd),
        this.git(['diff', '--name-status', baseRef], cwd),
        this.git(['diff', '--numstat', baseRef], cwd),
      ])

      const numStatMap = parseNumStat(numStat)

      // git diff only covers tracked files; also capture untracked files
      const untrackedRaw = await this.git(['ls-files', '--others', '--exclude-standard'], cwd).catch(() => '')
      const untrackedFiles = untrackedRaw.trim() ? untrackedRaw.trim().split('\n').filter(Boolean) : []

      let extraDiff = ''
      const extraFiles: DiffFile[] = []
      for (const file of untrackedFiles) {
        // git diff --no-index exits with code 1 when differences exist (normal, not an error)
        const fileDiff = await execa('git', ['diff', '--no-index', '--', '/dev/null', file], { cwd })
          .then(r => r.stdout)
          .catch((e: unknown) => {
            const err = e as { exitCode?: number; stdout?: string }
            return err.exitCode === 1 ? (err.stdout ?? '') : ''
          })
        if (fileDiff) {
          extraDiff += fileDiff + '\n'
          const added = fileDiff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length
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
      return { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    }
  }

  async getFileDiffContent(worktreePath: string, baseBranch: string, filePath: string): Promise<{ original: string; modified: string }> {
    const mergeBase = await execa('git', ['merge-base', 'HEAD', baseBranch], { cwd: worktreePath })
      .then(r => r.stdout.trim())
      .catch(() => '')
    const baseRef = mergeBase || baseBranch
    const original = await execa('git', ['show', `${baseRef}:${filePath}`], { cwd: worktreePath })
      .then(r => r.stdout)
      .catch(() => '')
    const modified = await readFile(join(worktreePath, filePath), 'utf8').catch(() => '')
    return { original, modified }
  }

  watchDiff(sessionId: string, baseBranch: string, callback: (diff: GitDiff) => void): FSWatcher {
    const worktreePath = this.getWorktreePath(sessionId)
    const watcher = watch(worktreePath, {
      ignored: /(node_modules|\.git)/,
      persistent: true,
      ignoreInitial: true,
    })

    let debounce: ReturnType<typeof setTimeout> | null = null
    const trigger = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void this.getDiff(sessionId, baseBranch).then(callback)
      }, 500)
    }

    watcher.on('add', trigger).on('change', trigger).on('unlink', trigger)
    this.watchers.set(sessionId, watcher)
    return watcher
  }

  async mergeToBase(
    branchName: string,
    baseBranch: string,
    strategy: 'squash' | 'merge' | 'rebase' = 'squash',
  ): Promise<void> {
    await this.git(['checkout', baseBranch])
    if (strategy === 'squash') {
      await this.git(['merge', '--squash', branchName])
      await this.git(['commit', '-m', `chore: squash merge ${branchName}`])
    } else if (strategy === 'merge') {
      await this.git(['merge', '--no-ff', '-m', `Merge ${branchName}`, branchName])
    } else {
      await this.git(['rebase', branchName])
    }
  }

  async getGitLog(sessionId: string, limit = 100): Promise<GitLogResponse> {
    const cwd = this.getWorktreePath(sessionId)
    try {
      const sep = '||'
      const fmt = `%H${sep}%h${sep}%s${sep}%an${sep}%ae${sep}%aI${sep}%P${sep}%D`
      const raw = await this.git(
        ['log', '--all', '--topo-order', `--max-count=${limit}`, `--format=${fmt}`],
        cwd,
      )
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
            .map(r => r.replace(/^HEAD -> /, '').replace(/^tag: /, ''))
          return { hash, shortHash, message, author, email, date, parents, refs }
        })

      const head = (await this.git(['rev-parse', 'HEAD'], cwd).catch(() => '')).trim()
      const branches = await this.getGitBranches(sessionId)
      return { commits, branches, head }
    } catch {
      return { commits: [], branches: [], head: '' }
    }
  }

  async getGitBranches(sessionId: string): Promise<GitBranch[]> {
    const cwd = this.getWorktreePath(sessionId)
    try {
      const raw = await this.git(['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(HEAD)'], cwd)
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

  async commitAll(sessionId: string, message: string): Promise<void> {
    const cwd = this.getWorktreePath(sessionId)
    await this.git(['add', '-A'], cwd)
    await this.git(['commit', '-m', message], cwd)
  }

  async discardAll(sessionId: string): Promise<void> {
    const cwd = this.getWorktreePath(sessionId)
    await this.git(['checkout', '--', '.'], cwd)
    await this.git(['clean', '-fd'], cwd)
  }

  async checkoutBranch(sessionId: string, branch: string, createNew = false): Promise<void> {
    const cwd = this.getWorktreePath(sessionId)
    if (createNew) {
      await this.git(['checkout', '-b', branch], cwd)
    } else {
      await this.git(['checkout', branch], cwd)
    }
  }

  getWorktreePath(sessionId: string): string {
    return join(this.worktreeBaseDir, sessionId)
  }

  private async git(args: string[], cwd = this.baseRepoPath): Promise<string> {
    const result = await execa('git', args, { cwd })
    return result.stdout
  }

  private async linkNodeModules(worktreePath: string): Promise<void> {
    const src = join(this.baseRepoPath, 'node_modules')
    const dst = join(worktreePath, 'node_modules')
    try {
      await access(src, constants.F_OK)
      await access(dst, constants.F_OK).catch(async () => {
        await symlink(src, dst, 'junction')
      })
    } catch {
      // src doesn't exist, skip
    }
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
