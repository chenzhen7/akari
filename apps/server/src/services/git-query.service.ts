import type { FSWatcher } from 'chokidar'
import type { GitBranch, GitDiff, GitLogResponse } from '@akari/shared-types'
import { GitRepositoryRegistry } from '../infrastructure/git/git-repository-registry.js'

export interface IGitQueryService {
  repoRoot: string
  getCurrentDiff(cwd: string): Promise<GitDiff>
  getGitLog(cwd: string, limit?: number, offset?: number, branch?: string): Promise<GitLogResponse>
  getGitBranches(cwd: string): Promise<GitBranch[]>
  getCommitFiles(cwd: string, hash: string): Promise<GitDiff['files']>
  getCommitFileDiff(cwd: string, hash: string, filePath: string): Promise<{ original: string; modified: string }>
  getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]>
  watchDiff(cwd: string, callbacks: {
    onChanged: () => void
    onFileChange?: (filePath: string, changeType: 'add' | 'change' | 'unlink') => void
  }): FSWatcher | null
  watchGitMetadata(repoPath: string, callback: () => void): Promise<FSWatcher | null>
  invalidateDiffCache(cwd: string): void
  invalidateGitLogCache(cwd: string): void
  getCurrentBranch(cwd?: string): Promise<string>
}

export class GitQueryService implements IGitQueryService {
  constructor(
    public readonly repoRoot: string,
    private readonly registry: GitRepositoryRegistry,
  ) {}

  async getCurrentDiff(cwd: string): Promise<GitDiff> {
    const emptyDiff: GitDiff = { files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    return (await this.registry.get(cwd)?.getDiff()) ?? emptyDiff
  }

  async getGitLog(cwd: string, limit = 100, offset = 0, branch?: string): Promise<GitLogResponse> {
    const emptyLog: GitLogResponse = { commits: [], branches: [], head: '' }
    return (await this.registry.get(cwd)?.getGitLog(limit, offset, branch)) ?? emptyLog
  }

  async getGitBranches(cwd: string): Promise<GitBranch[]> {
    return (await this.registry.get(cwd)?.getGitBranches()) ?? []
  }

  async getCommitFiles(cwd: string, hash: string): Promise<GitDiff['files']> {
    return (await this.registry.get(cwd)?.getCommitFiles(hash)) ?? []
  }

  async getCommitFileDiff(cwd: string, hash: string, filePath: string): Promise<{ original: string; modified: string }> {
    return (await this.registry.get(cwd)?.getCommitFileDiff(hash, filePath)) ?? { original: '', modified: '' }
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    return (await this.registry.get(this.repoRoot)?.getRepoBranches()) ?? []
  }

  watchDiff(cwd: string, callbacks: {
    onChanged: () => void
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

  invalidateGitLogCache(cwd: string): void {
    this.registry.get(cwd)?.invalidateGitLogCache()
  }

  async getCurrentBranch(cwd?: string): Promise<string> {
    return (await this.registry.get(cwd ?? this.repoRoot)?.getCurrentBranch()) ?? 'main'
  }
}
