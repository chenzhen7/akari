import { execa } from 'execa'
import { watch, type FSWatcher } from 'chokidar'
import { mkdir, symlink, rm, access, constants } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GitDiff, DiffFile } from '@akari/shared-types'

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
  ): Promise<{ branchName: string; worktreePath: string }> {
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

    return { branchName, worktreePath }
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
      const [stat, full, nameStatus] = await Promise.all([
        this.git(['diff', '--stat', baseBranch], cwd),
        this.git(['diff', baseBranch], cwd),
        this.git(['diff', '--name-status', baseBranch], cwd),
      ])
      return {
        stat,
        fullDiff: full,
        files: parseFileStatus(nameStatus),
        summary: parseStat(stat),
      }
    } catch {
      return { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    }
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

function parseStat(stat: string): { additions: number; deletions: number; files: number } {
  if (!stat.trim()) return { additions: 0, deletions: 0, files: 0 }
  return {
    files: parseInt(stat.match(/(\d+) file/)?.[1] ?? '0'),
    additions: parseInt(stat.match(/(\d+) insertion/)?.[1] ?? '0'),
    deletions: parseInt(stat.match(/(\d+) deletion/)?.[1] ?? '0'),
  }
}
