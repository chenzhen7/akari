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
   */
  get(path: string): GitRepository | null {
    const resolved = resolve(path)
    if (!this.detector.isGitRepository(resolved)) return null

    let repo = this.repositories.get(resolved)
    if (!repo) {
      repo = new GitRepository(resolved, this.runner)
      this.repositories.set(resolved, repo)
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
