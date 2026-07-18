import { watch, type FSWatcher } from 'chokidar'
import { mkdir, symlink, rm, access, constants, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve, dirname, basename, sep, relative } from 'node:path'
import type { GitDiff, GitBranch, GitLogResponse, FileNode } from '@akari/shared-types'
import { GitCommandRunner } from './git-command-runner.js'
import { GitRepositoryDetector } from './git-repository-detector.js'
import { GitRepositoryRegistry } from './git-repository-registry.js'

interface WatchDiffCallbacks {
  onDiff: (diff: GitDiff) => void
  onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
}

/**
 * Manages git worktrees for agent sessions.
 *
 * This class is intentionally focused on worktree lifecycle and filesystem
 * operations. All Git repository state queries (diff, log, branches, etc.) are
 * delegated to GitRepository instances via GitRepositoryRegistry.
 */
export class WorktreeManager {
  private readonly repoRoot: string
  private readonly workspacePath: string
  private readonly workspaceOffset: string
  private readonly worktreeBaseDir: string
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly detector: GitRepositoryDetector
  private readonly registry: GitRepositoryRegistry
  private readonly runner = new GitCommandRunner()

  constructor(repoRoot: string, workspacePath: string, worktreeBaseDir: string) {
    this.repoRoot = resolve(repoRoot)
    this.workspacePath = resolve(workspacePath)
    this.workspaceOffset = relative(this.repoRoot, this.workspacePath).replace(/\\/g, '/')
    this.worktreeBaseDir = resolve(worktreeBaseDir)
    this.detector = new GitRepositoryDetector(this.repoRoot, this.workspacePath, this.worktreeBaseDir)
    this.registry = new GitRepositoryRegistry(this.detector, this.runner)
  }

  private isAgentWorktree(cwd: string): boolean {
    return resolve(cwd).startsWith(this.worktreeBaseDir + sep)
  }

  private async resolveFilePath(filePath: string, cwd: string): Promise<string> {
    const normalized = filePath.replace(/\\/g, '/')
    if (this.isAgentWorktree(cwd)) {
      return join(cwd, normalized)
    }
    const offset = this.workspaceOffset
    if (offset && (normalized === offset || normalized.startsWith(offset + '/'))) {
      return join(this.repoRoot, normalized)
    }
    // Prefer workspace-relative if the file exists there.
    const workspaceAbsolute = join(this.workspacePath, normalized)
    try {
      await access(workspaceAbsolute, constants.F_OK)
      return workspaceAbsolute
    } catch {
      return join(this.repoRoot, normalized)
    }
  }

  async createWorktree(
    sessionId: string,
    baseBranch = 'main',
  ): Promise<{ branchName: string; worktreePath: string; resolvedBase: string }> {
    const branchName = `agent/${sessionId.slice(0, 8)}`
    const worktreePath = this.getWorktreePath(sessionId)

    await mkdir(this.worktreeBaseDir, { recursive: true })

    // Resolve base branch — fall back to current HEAD if requested branch doesn't exist
    let resolvedBase = baseBranch
    try {
      await this.runner.run(['rev-parse', '--verify', baseBranch], this.repoRoot)
    } catch {
      resolvedBase = (await this.runner.run(['rev-parse', '--abbrev-ref', 'HEAD'], this.repoRoot)).trim()
    }

    await this.runner.run(['worktree', 'add', '-b', branchName, worktreePath, resolvedBase], this.repoRoot)
    await this.linkNodeModules(worktreePath)
    this.registry.create(worktreePath)

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
    this.registry.delete(worktreePath)
    try {
      await this.runner.run(['worktree', 'remove', '--force', worktreePath], this.repoRoot)
    } catch {
      // worktree not registered in git — proceed to rm the directory directly
    }
    // Always attempt to remove the physical directory, even if git worktree remove succeeded
    try {
      await rm(worktreePath, { recursive: true, force: true })
    } catch {
      // directory may not exist or be locked — non-fatal
    }
    try {
      await this.runner.run(['worktree', 'prune'], this.repoRoot)
    } catch {
      // prune failure is non-fatal
    }
    if (branchName) {
      try {
        await this.runner.run(['branch', '-D', branchName], this.repoRoot)
      } catch {
        // branch may already be deleted — non-fatal
      }
    }
  }

  async getCurrentBranch(cwd = this.repoRoot): Promise<string> {
    return (await this.registry.get(cwd)?.getCurrentBranch()) ?? 'main'
  }

  async getDiff(sessionId: string, cwd?: string): Promise<GitDiff> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const emptyDiff: GitDiff = { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    return (await this.registry.get(worktreePath)?.getDiff()) ?? emptyDiff
  }

  async getFileDiffContent(worktreePath: string, filePath: string): Promise<{ original: string; modified: string }> {
    const modified = await this.resolveFilePath(filePath, worktreePath)
      .then((p) => readFile(p, 'utf8'))
      .catch(() => '')
    const repo = this.registry.get(worktreePath)
    if (!repo) return { original: '', modified }
    const { original } = await repo.getFileDiffContent(filePath)
    return { original, modified }
  }

  async getFileDiffLines(worktreePath: string, filePath: string): Promise<import('@akari/shared-types').FileDiffLine[]> {
    return (await this.registry.get(worktreePath)?.getFileDiffLines(filePath)) ?? []
  }

  watchDiff(sessionId: string, callbacks: WatchDiffCallbacks, watchPath?: string, cwd?: string): FSWatcher {
    const resolvedPath = resolve(watchPath ?? this.getWorktreePath(sessionId))
    const gitCwd = resolve(cwd ?? resolvedPath)
    const repo = this.registry.get(gitCwd)
    if (!repo) {
      // Not a git directory: avoid spawning git commands that would spam stderr with usage text.
      return watch([], { persistent: false, ignoreInitial: true })
    }
    const watcher = repo.watchDiff(callbacks)
    this.watchers.set(sessionId, watcher)
    return watcher
  }

  watchGitMetadata(sessionId: string, repoRoot: string, callback: () => void): FSWatcher | null {
    const repo = this.registry.get(repoRoot)
    if (!repo) {
      console.warn(`[WorktreeManager] cannot watch git metadata for non-git path: ${repoRoot}`)
      return null
    }
    const watcher = repo.watchGitMetadata(callback)
    if (!watcher) return null
    this.watchers.set(`${sessionId}:branch`, watcher)
    return watcher
  }

  async mergeIntoCurrentBranch(
    worktreePath: string,
    sourceBranch: string,
    strategy: 'squash' | 'merge' | 'rebase' = 'squash',
  ): Promise<void> {
    const repo = this.registry.get(worktreePath)
    if (!repo) throw new Error(`not a git repository: ${worktreePath}`)
    await repo.mergeIntoCurrentBranch(sourceBranch, strategy)
  }

  async updateFromBase(sessionId: string, sourceBranch: string, worktreePath: string): Promise<void> {
    const repo = this.registry.get(worktreePath)
    if (!repo) throw new Error(`not a git repository: ${worktreePath}`)
    await repo.updateFromBase(sourceBranch)
  }

  async getGitLog(sessionId: string, limit = 100, offset = 0, cwd?: string, branch?: string): Promise<GitLogResponse> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const emptyLog: GitLogResponse = { commits: [], branches: [], head: '' }
    return (await this.registry.get(worktreePath)?.getGitLog(limit, offset, branch)) ?? emptyLog
  }

  async getGitBranches(sessionId: string, cwd?: string): Promise<GitBranch[]> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    return (await this.registry.get(worktreePath)?.getGitBranches()) ?? []
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return (await this.registry.get(this.repoRoot)?.getRepoBranches()) ?? []
  }

  async commitAll(sessionId: string, message: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const repo = this.registry.get(worktreePath)
    if (!repo) throw new Error(`not a git repository: ${worktreePath}`)
    await repo.commitAll(message)
  }

  async discardAll(sessionId: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const repo = this.registry.get(worktreePath)
    if (!repo) throw new Error(`not a git repository: ${worktreePath}`)
    await repo.discardAll()
  }

  async checkoutBranch(sessionId: string, branch: string, createNew = false, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const repo = this.registry.get(worktreePath)
    if (!repo) throw new Error(`not a git repository: ${worktreePath}`)
    await repo.checkoutBranch(branch, createNew)
  }

  async discardFile(sessionId: string, filePath: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const absolutePath = await this.resolveFilePath(filePath, worktreePath)
    this.assertPathInWorktree(worktreePath, absolutePath)
    const repo = this.registry.get(worktreePath)
    if (!repo) throw new Error(`not a git repository: ${worktreePath}`)
    await repo.discardFile(filePath)
  }

  private assertPathInWorktree(worktreePath: string, filePath: string): string {
    const resolvedFile = resolve(filePath)
    const allowedBase = this.isAgentWorktree(worktreePath) ? resolve(worktreePath) : this.repoRoot
    const isInside = resolvedFile === allowedBase || resolvedFile.startsWith(allowedBase + sep)
    if (!isInside) {
      throw new Error(`invalid file path: ${filePath}`)
    }
    return resolvedFile
  }

  async listFiles(sessionId: string, relativePath: string, cwd?: string): Promise<FileNode[]> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const targetPath = join(worktreePath, relativePath)

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      const filtered = entries.filter((entry) => {
        if (entry.name === 'node_modules') return false
        if (entry.name === '.git') return false
        if (entry.name === '.agent-worktrees') return false
        return true
      })

      const nodes: FileNode[] = filtered.map((entry) => ({
        name: entry.name,
        path: join(relativePath, entry.name).replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
      }))

      nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })

      return nodes
    } catch {
      // Worktree not ready or directory doesn't exist — return empty list
      return []
    }
  }

  async readFileContent(sessionId: string, filePath: string, cwd?: string): Promise<string> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const fullPath = await this.resolveFilePath(filePath, worktreePath)

    const stats = await access(fullPath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
    if (!stats) throw new Error(`File not found: ${filePath}`)

    return readFile(fullPath, 'utf8')
  }

  async writeFileContent(sessionId: string, filePath: string, content: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const fullPath = await this.resolveWritePath(filePath, worktreePath)

    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }

  private async resolveWritePath(filePath: string, cwd: string): Promise<string> {
    const normalized = filePath.replace(/\\/g, '/')
    if (this.isAgentWorktree(cwd)) {
      return join(cwd, normalized)
    }
    const offset = this.workspaceOffset
    if (offset && (normalized === offset || normalized.startsWith(offset + '/'))) {
      return join(this.repoRoot, normalized)
    }
    return join(this.workspacePath, normalized)
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
    await this.registry.dispose().catch((err) => {
      console.warn('[WorktreeManager] registry.dispose failed (non-fatal):', err)
    })
    await this.detector.dispose().catch((err) => {
      console.warn('[WorktreeManager] detector.dispose failed (non-fatal):', err)
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
