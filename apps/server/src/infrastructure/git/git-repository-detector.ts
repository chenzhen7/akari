import { existsSync, readdirSync, type Dirent } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

/**
 * VSCode-style Git repository detector.
 *
 * Instead of spawning `git rev-parse` on every hot-path call, this class treats
 * Git repository membership as a filesystem fact: a directory is a Git repo if
 * it contains a `.git` entry (directory or file, as with worktrees). Known roots
 * are maintained in a Set, and the workspace is watched so roots appear/disappear
 * as `.git` entries are created or removed.
 */
export class GitRepositoryDetector {
  private readonly roots = new Set<string>()
  private readonly watcher: FSWatcher | null = null

  constructor(
    private readonly repoRoot: string,
    private readonly workspacePath: string,
    worktreeBaseDir?: string,
  ) {
    // 只以 repoRoot（getGitRoot 的 git rev-parse --show-toplevel 结果）为根。
    // 不再注册 workspacePath：当工作区是 git 根的子目录且自身带一个 git 忽略掉的
    // .git 时（如嵌套/残留目录），注册它会让 findRepositoryRoot 归一化到工作区，
    // 导致 git diff -- <pathspec> 按 cwd 解析与 status/cat-file 的根相对路径错位。
    // 工作区自身若真是 git 根，getGitRoot 返回的 repoRoot 即等于它，无需重复注册。
    this.registerIfGit(this.repoRoot)
    if (worktreeBaseDir) {
      this.discoverWorktrees(worktreeBaseDir)
    }

    // Only watch the .git entry at the repo/workspace roots. Worktrees are
    // registered/unregistered explicitly by createWorktree/removeWorktree, so
    // we do not need to scan the entire workspace for stray .git directories.
    const gitPaths = [this.repoRoot, this.workspacePath]
      .map((p) => resolve(join(p, '.git')))
      .filter((p, i, arr) => arr.indexOf(p) === i)

    this.watcher = watch(gitPaths, {
      ignoreInitial: true,
      persistent: true,
    })

    this.watcher.on('addDir', (absolutePath) => this.onGitFound(absolutePath))
    this.watcher.on('unlinkDir', (absolutePath) => this.onGitLost(absolutePath))
    this.watcher.on('add', (absolutePath) => this.onGitFound(absolutePath))
    this.watcher.on('unlink', (absolutePath) => this.onGitLost(absolutePath))
  }

  /**
   * Register a worktree path after it has been successfully created.
   */
  registerWorktree(worktreePath: string): void {
    this.registerIfGit(worktreePath)
  }

  /**
   * Unregister a worktree path before/after it is removed.
   */
  unregisterWorktree(worktreePath: string): void {
    this.roots.delete(resolve(worktreePath))
  }

  /**
   * Synchronous O(directory depth) check. Safe to call on hot paths.
   */
  isGitRepository(cwd: string): boolean {
    return this.findRepositoryRoot(cwd) !== null
  }

  /**
   * Given a path, walk up the directory tree and return the nearest known Git
   * repository root. Returns null if none is found.
   */
  findRepositoryRoot(cwd: string): string | null {
    let current = resolve(cwd)
    while (true) {
      if (this.roots.has(current)) return current
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return null
  }

  async dispose(): Promise<void> {
    await this.watcher?.close()
  }

  private discoverWorktrees(worktreeBaseDir: string): void {
    const resolvedBase = resolve(worktreeBaseDir)
    if (!existsSync(resolvedBase)) return

    const repoSlug = basename(this.repoRoot)
    const repoWorktreeDir = join(resolvedBase, repoSlug)
    if (!existsSync(repoWorktreeDir)) return

    let entries: Dirent[]
    try {
      entries = readdirSync(repoWorktreeDir, { withFileTypes: true })
    } catch {
      // Directory may be inaccessible; scanning failures are non-fatal.
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const worktreePath = join(repoWorktreeDir, entry.name)
      this.registerIfGit(worktreePath)
    }
  }

  private onGitFound(absolutePath: string): void {
    const root = dirname(resolve(absolutePath))
    this.roots.add(root)
  }

  private onGitLost(absolutePath: string): void {
    const root = dirname(resolve(absolutePath))
    this.roots.delete(root)
  }

  private registerIfGit(path: string): void {
    const resolved = resolve(path)
    if (existsSync(join(resolved, '.git'))) {
      this.roots.add(resolved)
    }
  }
}
