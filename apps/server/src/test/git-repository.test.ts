import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { GitRepository } from '../git-repository.js'

const run = vi.fn()
const runner = { run } as unknown as import('../git-command-runner.js').GitCommandRunner

const watchEmitter = Object.assign(new EventEmitter(), {
  close: vi.fn().mockResolvedValue(undefined),
})

vi.mock('chokidar', () => ({
  watch: vi.fn(() => watchEmitter),
}))

describe('GitRepository', () => {
  beforeEach(() => {
    run.mockReset()
    watchEmitter.removeAllListeners()
  })

  it('caches current branch', async () => {
    run.mockResolvedValueOnce('main\n')
    const repo = new GitRepository('/repo', runner)
    const first = await repo.getCurrentBranch()
    const second = await repo.getCurrentBranch()
    expect(first).toBe('main')
    expect(second).toBe('main')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('returns main when git fails', async () => {
    run.mockRejectedValueOnce(new Error('not a git repo'))
    const repo = new GitRepository('/repo', runner)
    expect(await repo.getCurrentBranch()).toBe('main')
  })

  it('invalidates repo cache', async () => {
    run.mockResolvedValueOnce('main\n')
    const repo = new GitRepository('/repo', runner)
    await repo.getCurrentBranch()
    repo.invalidateRepoCache()
    run.mockResolvedValueOnce('feature\n')
    expect(await repo.getCurrentBranch()).toBe('feature')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('computes and caches diff', async () => {
    run.mockImplementation((args: string[]) => {
      if (args.includes('--stat')) return Promise.resolve('1 file changed, 2 insertions(+), 1 deletion(-)')
      if (args.includes('--name-status')) return Promise.resolve('M\tfoo.ts')
      if (args.includes('--numstat')) return Promise.resolve('2\t1\tfoo.ts')
      if (args[0] === 'ls-files') return Promise.resolve('')
      return Promise.resolve('diff --git a/foo.ts b/foo.ts\n')
    })
    const repo = new GitRepository('/repo', runner)
    const diff1 = await repo.getDiff()
    const diff2 = await repo.getDiff()
    expect(diff1.files).toHaveLength(1)
    expect(diff1.files[0].path).toBe('foo.ts')
    expect(diff2).toBe(diff1)
    expect(run).toHaveBeenCalledTimes(5)
  })

  it('clears diff cache on invalidateDiffCache', async () => {
    run.mockImplementation((args: string[]) => {
      if (args.includes('--stat')) return Promise.resolve('')
      if (args.includes('--name-status')) return Promise.resolve('')
      if (args.includes('--numstat')) return Promise.resolve('')
      if (args[0] === 'ls-files') return Promise.resolve('')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    await repo.getDiff()
    repo.invalidateDiffCache()
    await repo.getDiff()
    expect(run).toHaveBeenCalledTimes(10)
  })

  it('returns original file content from HEAD', async () => {
    run.mockResolvedValueOnce('original content')
    const repo = new GitRepository('/repo', runner)
    const result = await repo.getFileDiffContent('foo.ts')
    expect(result.original).toBe('original content')
    expect(run).toHaveBeenCalledWith(['show', 'HEAD:foo.ts'], '/repo')
  })

  it('parses git log output', async () => {
    run.mockImplementation((args: string[]) => {
      if (args[0] === 'log') {
        return Promise.resolve('hash1||short1||msg||author||email||2024-01-01T00:00:00Z|| ||HEAD -> main')
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return Promise.resolve('hash1\n')
      if (args[0] === 'branch') return Promise.resolve('* main|hash1|*')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const log = await repo.getGitLog(10, 0)
    expect(log.commits).toHaveLength(1)
    expect(log.commits[0].hash).toBe('hash1')
    expect(log.head).toBe('hash1')
  })
})
