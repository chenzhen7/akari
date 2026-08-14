import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve, join } from 'node:path'
import { GitRepositoryDetector } from '../infrastructure/git/git-repository-detector.js'

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

  it('registers only repoRoot; workspacePath is not registered as a root', () => {
    // 即使 workspacePath 目录里有 .git，也不再单独注册为根：根一律以 git toplevel
    // （repoRoot = git rev-parse --show-toplevel）为准。残留/被 git 忽略的 .git 会
    // 让 findRepositoryRoot 归一化到工作区，导致 pathspec 与 status/cat-file 错位。
    vi.mocked(existsSync).mockImplementation((p: string) => {
      return p === gitPath('/repo') || p === gitPath('/workspace')
    })

    const detector = new GitRepositoryDetector('/repo', '/workspace')

    expect(detector.isGitRepository('/repo')).toBe(true)
    expect(detector.isGitRepository('/workspace')).toBe(false)
    expect(detector.isGitRepository('/other')).toBe(false)
  })

  it('normalizes a workspace subdir (even with stray .git) to the parent git root', () => {
    // 回归：工作区是 git 根的子目录且自身带 .git 时，findRepositoryRoot 必须返回父级
    // git 根（与 git rev-parse --show-toplevel 一致），否则 git diff -- <pathspec>
    // 按 cwd 解析与 status/cat-file 的根相对路径错位、diff 静默为空。
    vi.mocked(existsSync).mockImplementation((p: string) => {
      return p === gitPath('/repo') || p === gitPath('/repo/sub')
    })

    const detector = new GitRepositoryDetector('/repo', '/repo/sub')

    expect(detector.findRepositoryRoot('/repo/sub')).toBe(resolve('/repo'))
    expect(detector.findRepositoryRoot('/repo/sub/docs')).toBe(resolve('/repo'))
    expect(detector.findRepositoryRoot('/repo/sub/file.ts')).toBe(resolve('/repo'))
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
