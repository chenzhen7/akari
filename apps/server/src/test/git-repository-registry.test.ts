import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitRepositoryRegistry } from '../infrastructure/git/git-repository-registry.js'

describe('GitRepositoryRegistry', () => {
  const detector = {
    isGitRepository: vi.fn(),
    registerWorktree: vi.fn(),
    unregisterWorktree: vi.fn(),
  } as unknown as import('../git-repository-detector.js').GitRepositoryDetector

  const runner = { run: vi.fn() } as unknown as import('../git-command-runner.js').GitCommandRunner

  beforeEach(() => {
    vi.mocked(detector.isGitRepository).mockReset()
    vi.mocked(detector.registerWorktree).mockReset()
    vi.mocked(detector.unregisterWorktree).mockReset()
    vi.mocked(runner.run).mockReset()
  })

  it('returns null for non-git paths', () => {
    vi.mocked(detector.isGitRepository).mockReturnValue(false)
    const registry = new GitRepositoryRegistry(detector, runner)
    expect(registry.get('/not-git')).toBeNull()
  })

  it('creates and reuses GitRepository for git paths', () => {
    vi.mocked(detector.isGitRepository).mockReturnValue(true)
    const registry = new GitRepositoryRegistry(detector, runner)
    const repo1 = registry.get('/repo')
    const repo2 = registry.get('/repo')
    expect(repo1).not.toBeNull()
    expect(repo1).toBe(repo2)
  })

  it('create registers worktree with detector', () => {
    vi.mocked(detector.isGitRepository).mockReturnValue(false)
    const registry = new GitRepositoryRegistry(detector, runner)
    registry.create('/worktree')
    expect(vi.mocked(detector.registerWorktree)).toHaveBeenCalledWith(expect.stringMatching(/worktree$/))
  })

  it('create returns existing repo if already registered', () => {
    vi.mocked(detector.isGitRepository).mockReturnValue(true)
    const registry = new GitRepositoryRegistry(detector, runner)
    const repo1 = registry.get('/repo')
    const repo2 = registry.create('/repo')
    expect(repo1).toBe(repo2)
  })

  it('delete unregisters worktree and disposes repo', async () => {
    vi.mocked(detector.isGitRepository).mockReturnValue(true)
    const registry = new GitRepositoryRegistry(detector, runner)
    const repo = registry.get('/repo')
    expect(repo).not.toBeNull()

    registry.delete('/repo')
    expect(vi.mocked(detector.unregisterWorktree)).toHaveBeenCalledWith(expect.stringMatching(/repo$/))
  })
})
