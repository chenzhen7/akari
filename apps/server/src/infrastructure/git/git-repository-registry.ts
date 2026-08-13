import { resolve } from 'node:path'
import type { GitRepositoryDetector } from './git-repository-detector.js'
import { GitCommandRunner } from './git-command-runner.js'
import { GitRepository } from './git-repository.js'

/**
 * Owns GitRepository instances and their lifecycle.
 *
 * A repository is created lazily on first access. The detector decides whether
 * a path is actually a Git repository; callers receive null for non-Git paths.
 */
export class GitRepositoryRegistry {
  private readonly repositories = new Map<string, GitRepository>()

  constructor(
    private readonly detector: GitRepositoryDetector,
    private readonly runner: GitCommandRunner,
  ) {}

  /**
   * Get an existing or new repository for a path, but only if the detector
   * considers the path a Git repository.
   *
   * 仓库实例归一到 git 根（detector.findRepositoryRoot）：当传入路径是 git 根的
   * 子目录时（如主会话工作区在仓库内），git 命令以根为 cwd 执行，根相对的
   * pathspec（`git status`/`numstat` 输出）才能正确匹配。磁盘读取与前端绝对路径
   * 已各自处理 workspaceOffset，此处补齐 Git 侧的一致性。
   */
  get(path: string): GitRepository | null {
    const resolved = resolve(path)
    const found = this.detector.findRepositoryRoot(resolved)
    if (!found) return null
    const root = resolve(found)

    let repo = this.repositories.get(root)
    if (!repo) {
      repo = new GitRepository(root, this.runner)
      this.repositories.set(root, repo)
    }
    return repo
  }

  /**
   * Create a repository entry for a path that has just become a Git repository
   * (e.g. after `git worktree add`). This also tells the detector about it.
   */
  create(path: string): GitRepository {
    const resolved = resolve(path)
    this.detector.registerWorktree(resolved)

    let repo = this.repositories.get(resolved)
    if (!repo) {
      repo = new GitRepository(resolved, this.runner)
      this.repositories.set(resolved, repo)
    }
    return repo
  }

  /**
   * Remove a repository entry (e.g. before deleting a worktree).
   */
  delete(path: string): void {
    const resolved = resolve(path)
    const repo = this.repositories.get(resolved)
    if (repo) {
      repo.dispose().catch((err) => {
        console.warn(`[GitRepositoryRegistry] dispose failed for ${resolved}:`, err)
      })
      this.repositories.delete(resolved)
    }
    this.detector.unregisterWorktree(resolved)
  }

  async dispose(): Promise<void> {
    for (const repo of this.repositories.values()) {
      await repo.dispose().catch((err) => {
        console.warn(`[GitRepositoryRegistry] dispose failed for ${repo.path}:`, err)
      })
    }
    this.repositories.clear()
  }
}
