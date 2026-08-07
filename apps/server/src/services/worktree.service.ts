import { watch, type FSWatcher } from 'chokidar'
import { mkdir, symlink, rm, access, constants } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import type { GitBranch, GitDiff, DiffHunk, FileDiffLine, GitLogResponse } from '@akari/shared-types'
import { GitCommandRunner } from '../infrastructure/git/git-command-runner.js'
import { GitRepositoryDetector } from '../infrastructure/git/git-repository-detector.js'
import { GitRepositoryRegistry } from '../infrastructure/git/git-repository-registry.js'
import { IFileSystemService } from '../infrastructure/fs/file-system.service.js'
import { IGitQueryService } from './git-query.service.js'

export interface IWorktreeService {
  createWorktree(sessionId: string, baseBranch?: string): Promise<{ branchName: string; worktreePath: string; resolvedBase: string }>
  removeWorktree(sessionId: string, worktreePath: string, branchName?: string): Promise<void>
  commitAll(sessionId: string, message: string, cwd: string): Promise<void>
  commitFiles(sessionId: string, message: string, filePaths: string[], cwd: string): Promise<void>
  discardAll(sessionId: string, cwd: string): Promise<void>
  discardFile(sessionId: string, filePath: string, cwd: string): Promise<void>
  checkoutBranch(sessionId: string, branch: string, createNew: boolean, cwd: string): Promise<void>
  mergeIntoCurrentBranch(targetCwd: string, sourceBranch: string, strategy?: 'squash' | 'merge' | 'rebase'): Promise<void>
  updateFromBase(sessionId: string, sourceBranch: string, cwd: string): Promise<void>
  pullMain(cwd: string): Promise<void>
  pushMain(cwd: string): Promise<{ upToDate: boolean }>
  getFileDiffContent(cwd: string, filePath: string): Promise<{ original: string; modified: string }>
  getFileDiffLines(cwd: string, filePath: string): Promise<FileDiffLine[]>
  getFileDiffHunks(cwd: string, filePath: string): Promise<DiffHunk[]>
  getCurrentDiff(cwd: string): Promise<GitDiff>
  getGitLog(cwd: string, limit?: number, offset?: number, branch?: string): Promise<GitLogResponse>
  getGitBranches(cwd: string): Promise<GitBranch[]>
  getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]>
  watchDiff(sessionId: string, callbacks: {
    onChanged: () => void
    onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
  }, cwd?: string): FSWatcher
  watchGitMetadata(sessionId: string, repoPath: string, callback: () => void): Promise<FSWatcher | null>
  invalidateDiffCache(cwd: string): void
  invalidateGitLogCache(cwd: string): void
  getCurrentBranch(cwd?: string): Promise<string>
  getWorktreePath(sessionId: string): string
  dispose(): Promise<void>
}

export class WorktreeService implements IWorktreeService {
  private readonly repoRoot: string
  private readonly workspacePath: string
  private readonly worktreeBaseDir: string
  private readonly runners: { runner: GitCommandRunner; detector: GitRepositoryDetector; registry: GitRepositoryRegistry }
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(
    repoRoot: string,
    workspacePath: string,
    worktreeBaseDir: string,
    private readonly fileService: IFileSystemService,
    private readonly gitQuery: IGitQueryService,
    registry?: GitRepositoryRegistry,
    runner?: GitCommandRunner,
    detector?: GitRepositoryDetector,
  ) {
    this.repoRoot = resolve(repoRoot)
    this.workspacePath = resolve(workspacePath)
    this.worktreeBaseDir = resolve(worktreeBaseDir)
    const actualRunner = runner ?? new GitCommandRunner()
    const actualDetector = detector ?? new GitRepositoryDetector(this.repoRoot, this.workspacePath, this.worktreeBaseDir)
    const actualRegistry = registry ?? new GitRepositoryRegistry(actualDetector, actualRunner)
    this.runners = { runner: actualRunner, detector: actualDetector, registry: actualRegistry }
  }

  async createWorktree(
    sessionId: string,
    baseBranch = 'main',
  ): Promise<{ branchName: string; worktreePath: string; resolvedBase: string }> {
    const branchName = `agent/${sessionId.slice(0, 8)}`
    const worktreePath = this.getWorktreePath(sessionId)

    await mkdir(this.worktreeBaseDir, { recursive: true })

    let resolvedBase = baseBranch
    try {
      await this.runners.runner.runRead(['rev-parse', '--verify', baseBranch], this.repoRoot)
    } catch {
      resolvedBase = (await this.runners.runner.runRead(['rev-parse', '--abbrev-ref', 'HEAD'], this.repoRoot)).trim()
    }

    await this.runners.runner.run(['worktree', 'add', '-b', branchName, worktreePath, resolvedBase], this.repoRoot)
    await this.linkNodeModules(worktreePath)
    this.runners.registry.create(worktreePath)

    return { branchName, worktreePath, resolvedBase }
  }

  async removeWorktree(sessionId: string, worktreePath: string, branchName?: string): Promise<void> {
    const watcher = this.watchers.get(sessionId)
    if (watcher) {
      await watcher.close()
      this.watchers.delete(sessionId)
    }
    const branchWatcher = this.watchers.get(`${sessionId}:branch`)
    if (branchWatcher) {
      await branchWatcher.close()
      this.watchers.delete(`${sessionId}:branch`)
    }
    this.runners.registry.delete(worktreePath)
    // git worktree remove --force 会把 junction 当普通目录递归删除，
    // 连带清空主仓库的 node_modules（已实测复现）。先显式解除 worktree 内的
    // node_modules junction——Node 的 rm 只删除链接本身，不跟随目标。
    await rm(join(worktreePath, 'node_modules'), { force: true }).catch(() => {
      // node_modules 若不是 junction 而是真实目录（用户在 worktree 内独立装过依赖），
      // rm 非递归会失败，留由下面的 git worktree remove 正常递归删除
    })
    try {
      await this.runners.runner.run(['worktree', 'remove', '--force', worktreePath], this.repoRoot)
    } catch {
      // worktree not registered in git — proceed to rm the directory directly
    }
    try {
      await rm(worktreePath, { recursive: true, force: true })
    } catch {
      // directory may not exist or be locked — non-fatal
    }
    try {
      await this.runners.runner.run(['worktree', 'prune'], this.repoRoot)
    } catch {
      // prune failure is non-fatal
    }
    if (branchName) {
      try {
        await this.runners.runner.run(['branch', '-D', branchName], this.repoRoot)
      } catch {
        // branch may already be deleted — non-fatal
      }
    }
  }

  async commitAll(_sessionId: string, message: string, cwd: string): Promise<void> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.commitAll(message)
  }

  async commitFiles(_sessionId: string, message: string, filePaths: string[], cwd: string): Promise<void> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.commitFiles(message, filePaths)
  }

  async discardAll(_sessionId: string, cwd: string): Promise<void> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.discardAll()
  }

  async discardFile(_sessionId: string, filePath: string, cwd: string): Promise<void> {
    const absolutePath = await this.fileService.resolveFilePath(filePath, cwd)
    this.fileService.assertPathInWorktree(cwd, absolutePath)
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.discardFile(filePath)
  }

  async checkoutBranch(_sessionId: string, branch: string, createNew = false, cwd: string): Promise<void> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.checkoutBranch(branch, createNew)
  }

  async mergeIntoCurrentBranch(
    targetCwd: string,
    sourceBranch: string,
    strategy: 'squash' | 'merge' | 'rebase' = 'squash',
  ): Promise<void> {
    const repo = this.runners.registry.get(targetCwd)
    if (!repo) throw new Error(`not a git repository: ${targetCwd}`)
    await repo.mergeIntoCurrentBranch(sourceBranch, strategy)
  }

  async updateFromBase(_sessionId: string, sourceBranch: string, cwd: string): Promise<void> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.updateFromBase(sourceBranch)
  }

  async pullMain(cwd: string): Promise<void> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    await repo.pullMain()
  }

  async pushMain(cwd: string): Promise<{ upToDate: boolean }> {
    const repo = this.runners.registry.get(cwd)
    if (!repo) throw new Error(`not a git repository: ${cwd}`)
    return repo.pushMain()
  }

  async getFileDiffContent(cwd: string, filePath: string): Promise<{ original: string; modified: string }> {
    const modified = await this.fileService.resolveFilePath(filePath, cwd)
      .then((p) => import('node:fs/promises').then(m => m.readFile(p, 'utf8')))
      .catch(() => '')
    const repo = this.runners.registry.get(cwd)
    if (!repo) return { original: '', modified }
    const { original } = await repo.getFileDiffContent(filePath)
    return { original, modified }
  }

  async getFileDiffLines(cwd: string, filePath: string): Promise<FileDiffLine[]> {
    return (await this.runners.registry.get(cwd)?.getFileDiffLines(filePath)) ?? []
  }

  async getFileDiffHunks(cwd: string, filePath: string): Promise<DiffHunk[]> {
    return (await this.runners.registry.get(cwd)?.getFileDiffHunks(filePath)) ?? []
  }

  async getCurrentDiff(cwd: string): Promise<GitDiff> {
    return this.gitQuery.getCurrentDiff(cwd)
  }

  async getGitLog(cwd: string, limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    return this.gitQuery.getGitLog(cwd, limit, offset, branch)
  }

  async getGitBranches(cwd: string): Promise<GitBranch[]> {
    return this.gitQuery.getGitBranches(cwd)
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return this.gitQuery.getRepoBranches()
  }

  watchDiff(
    sessionId: string,
    callbacks: { onChanged: () => void; onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void },
    cwd?: string,
  ): FSWatcher {
    const resolvedPath = resolve(cwd ?? this.getWorktreePath(sessionId))
    const repo = this.runners.registry.get(resolvedPath)
    if (!repo) {
      return watch([], { persistent: false, ignoreInitial: true })
    }
    const watcher = repo.watchDiff(callbacks)
    this.watchers.set(sessionId, watcher)
    return watcher
  }

  async watchGitMetadata(sessionId: string, repoPath: string, callback: () => void): Promise<FSWatcher | null> {
    const watcher = await this.gitQuery.watchGitMetadata(repoPath, callback)
    if (!watcher) return null
    this.watchers.set(`${sessionId}:branch`, watcher)
    return watcher
  }

  invalidateDiffCache(cwd: string): void {
    this.gitQuery.invalidateDiffCache(cwd)
  }

  invalidateGitLogCache(cwd: string): void {
    this.gitQuery.invalidateGitLogCache(cwd)
  }

  async getCurrentBranch(cwd?: string): Promise<string> {
    return this.gitQuery.getCurrentBranch(cwd ?? this.repoRoot)
  }

  getWorktreePath(sessionId: string): string {
    const repoSlug = basename(this.repoRoot)
    return join(this.worktreeBaseDir, repoSlug, sessionId)
  }

  async dispose(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      await watcher.close()
    }
    this.watchers.clear()
    await this.runners.registry.dispose().catch((err) => {
      console.warn('[WorktreeService] registry.dispose failed (non-fatal):', err)
    })
    await this.runners.detector.dispose().catch((err) => {
      console.warn('[WorktreeService] detector.dispose failed (non-fatal):', err)
    })
  }

  private async linkNodeModules(worktreePath: string): Promise<void> {
    const src = join(this.repoRoot, 'node_modules')
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
