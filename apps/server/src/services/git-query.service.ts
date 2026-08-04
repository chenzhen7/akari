import type { FSWatcher } from 'chokidar'
import type { GitBranch, GitDiff, GitLogResponse } from '@akari/shared-types'
import { GitRepositoryRegistry } from '../infrastructure/git/git-repository-registry.js'

export interface IGitQueryService {
  repoRoot: string
  getCurrentDiff(cwd: string): Promise<GitDiff>
  getGitLog(cwd: string, limit?: number, offset?: number, branch?: string): Promise<GitLogResponse>
  getGitBranches(cwd: string): Promise<GitBranch[]>
  getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]>
  watchDiff(cwd: string, callbacks: {
    onDiff: (diff: GitDiff) => void
    onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
  }): FSWatcher | null
  watchGitMetadata(repoPath: string, callback: () => void): Promise<FSWatcher | null>
  invalidateDiffCache(cwd: string): void
  getCurrentBranch(cwd?: string): Promise<string>
}

export class GitQueryService implements IGitQueryService {
  constructor(
    public readonly repoRoot: string,
    private readonly registry: GitRepositoryRegistry,
  ) {}

  async getCurrentDiff(cwd: string): Promise<GitDiff> {
    const emptyDiff: GitDiff = { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    return (await this.registry.get(cwd)?.getDiff()) ?? emptyDiff
  }

  async getGitLog(cwd: string, limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    const emptyLog: GitLogResponse = { commits: [], branches: [], head: '' }
    return (await this.registry.get(cwd)?.getGitLog(limit, offset, branch)) ?? emptyLog
  }

  async getGitBranches(cwd: string): Promise<GitBranch[]> {
    return (await this.registry.get(cwd)?.getGitBranches()) ?? []
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return (await this.registry.get(this.repoRoot)?.getRepoBranches()) ?? []
  }

  watchDiff(cwd: string, callbacks: {
    onDiff: (diff: GitDiff) => void
    onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
  }): FSWatcher | null {
    const repo = this.registry.get(cwd)
    if (!repo) return null
    return repo.watchDiff(callbacks)
  }

  watchGitMetadata(repoPath: string, callback: () => void): Promise<FSWatcher | null> {
    const repo = this.registry.get(repoPath)
    if (!repo) return Promise.resolve(null)
    return repo.watchGitMetadata(callback)
  }

  invalidateDiffCache(cwd: string): void {
    this.registry.get(cwd)?.invalidateDiffCache()
  }

  async getCurrentBranch(cwd?: string): Promise<string> {
    return (await this.registry.get(cwd ?? this.repoRoot)?.getCurrentBranch()) ?? 'main'
  }
}
