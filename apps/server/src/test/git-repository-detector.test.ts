import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve, join } from 'node:path'
import { GitRepositoryDetector } from '../git-repository-detector.js'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}))

const watchEmitter = Object.assign(new EventEmitter(), {
  close: vi.fn().mockResolvedValue(undefined),
})

vi.mock('chokidar', () => ({
  watch: vi.fn(() => watchEmitter),
}))

import { existsSync, readdirSync } from 'node:fs'
import { watch } from 'chokidar'

function gitPath(dir: string): string {
  return resolve(join(dir, '.git'))
}

describe('GitRepositoryDetector', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset()
    vi.mocked(readdirSync).mockReset()
    watchEmitter.removeAllListeners()
    vi.mocked(watch).mockClear()
    vi.mocked(watchEmitter.close).mockClear()
  })

  it('registers repoRoot and workspacePath when they contain .git', () => {
    vi.mocked(existsSync).mockImplementation((p: string) => {
      return p === gitPath('/repo') || p === gitPath('/workspace')
    })

    const detector = new GitRepositoryDetector('/repo', '/workspace')

    expect(detector.isGitRepository('/repo')).toBe(true)
    expect(detector.isGitRepository('/workspace')).toBe(true)
    expect(detector.isGitRepository('/other')).toBe(false)
  })

  it('finds repository root by walking up from child paths', () => {
    vi.mocked(existsSync).mockImplementation((p: string) => p === gitPath('/repo'))

    const detector = new GitRepositoryDetector('/repo', '/workspace')

    expect(detector.findRepositoryRoot('/repo/src/nested')).toBe(resolve('/repo'))
    expect(detector.findRepositoryRoot('/repo')).toBe(resolve('/repo'))
    expect(detector.findRepositoryRoot('/unrelated')).toBeNull()
  })

  it('registers and unregisters worktrees', () => {
    vi.mocked(existsSync).mockImplementation((p: string) => {
      return p === gitPath('/repo') || p === gitPath('/worktrees/repo/abc123')
    })

    const detector = new GitRepositoryDetector('/repo', '/workspace')

    detector.registerWorktree('/worktrees/repo/abc123')
    expect(detector.isGitRepository('/worktrees/repo/abc123')).toBe(true)
    expect(detector.findRepositoryRoot('/worktrees/repo/abc123/src')).toBe(resolve('/worktrees/repo/abc123'))

    detector.unregisterWorktree('/worktrees/repo/abc123')
    expect(detector.isGitRepository('/worktrees/repo/abc123')).toBe(false)
  })

  it('discovers existing worktrees under worktreeBaseDir', () => {
    vi.mocked(existsSync).mockImplementation((p: string) => {
      return (
        p === gitPath('/repo') ||
        p === resolve('/worktrees') ||
        p === resolve('/worktrees/repo') ||
        p === gitPath('/worktrees/repo/wt1') ||
        p === gitPath('/worktrees/repo/wt2')
      )
    })
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'wt1', isDirectory: () => true },
      { name: 'wt2', isDirectory: () => true },
      { name: 'not-a-dir', isDirectory: () => false },
    ] as unknown as ReturnType<typeof readdirSync>)

    const detector = new GitRepositoryDetector('/repo', '/workspace', '/worktrees')

    expect(detector.isGitRepository('/worktrees/repo/wt1')).toBe(true)
    expect(detector.isGitRepository('/worktrees/repo/wt2')).toBe(true)
    expect(vi.mocked(readdirSync)).toHaveBeenCalledWith(resolve('/worktrees/repo'), { withFileTypes: true })
  })

  it('watches only repoRoot and workspacePath .git entries', () => {
    vi.mocked(existsSync).mockImplementation(() => false)

    new GitRepositoryDetector('/repo', '/workspace')

    expect(vi.mocked(watch)).toHaveBeenCalledWith(
      [gitPath('/repo'), gitPath('/workspace')],
      expect.objectContaining({ ignoreInitial: true, persistent: true }),
    )
  })

  it('deduplicates .git paths when repoRoot equals workspacePath', () => {
    vi.mocked(existsSync).mockImplementation(() => false)

    new GitRepositoryDetector('/repo', '/repo')

    expect(vi.mocked(watch)).toHaveBeenCalledWith(
      [gitPath('/repo')],
      expect.objectContaining({ ignoreInitial: true, persistent: true }),
    )
  })

  it('updates roots when .git is created or removed via watcher', () => {
    vi.mocked(existsSync).mockImplementation(() => false)

    const detector = new GitRepositoryDetector('/repo', '/workspace')
    expect(detector.isGitRepository('/workspace')).toBe(false)

    watchEmitter.emit('addDir', gitPath('/workspace'))
    expect(detector.isGitRepository('/workspace')).toBe(true)
    expect(detector.findRepositoryRoot('/workspace/file.ts')).toBe(resolve('/workspace'))

    watchEmitter.emit('unlinkDir', gitPath('/workspace'))
    expect(detector.isGitRepository('/workspace')).toBe(false)
  })

  it('watches .git files as well as directories (worktree .git is a file)', () => {
    vi.mocked(existsSync).mockImplementation(() => false)

    const detector = new GitRepositoryDetector('/repo', '/workspace')

    watchEmitter.emit('add', gitPath('/workspace'))
    expect(detector.isGitRepository('/workspace')).toBe(true)

    watchEmitter.emit('unlink', gitPath('/workspace'))
    expect(detector.isGitRepository('/workspace')).toBe(false)
  })

  it('disposes the watcher', async () => {
    vi.mocked(existsSync).mockImplementation(() => false)

    const detector = new GitRepositoryDetector('/repo', '/workspace')
    await detector.dispose()

    expect(vi.mocked(watchEmitter.close)).toHaveBeenCalled()
  })
})
