import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitCommandRunner, GitError } from '../infrastructure/git/git-command-runner.js'

const execa = vi.fn()

vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execa(...args),
}))

describe('GitCommandRunner', () => {
  beforeEach(() => {
    execa.mockReset()
  })

  it('adds --no-pager and core.quotepath=false', async () => {
    execa.mockResolvedValueOnce({ stdout: 'main\n' })
    const runner = new GitCommandRunner()
    await runner.run(['rev-parse', '--abbrev-ref', 'HEAD'], '/repo')
    expect(execa).toHaveBeenCalledWith(
      'git',
      ['--no-pager', '-c', 'core.quotepath=false', 'rev-parse', '--abbrev-ref', 'HEAD'],
      expect.objectContaining({ cwd: '/repo', timeout: 30000 }),
    )
  })

  it('adds --no-ext-diff and --no-renames to diff commands', async () => {
    execa.mockResolvedValueOnce({ stdout: '' })
    const runner = new GitCommandRunner()
    await runner.run(['diff', '--stat', 'HEAD'], '/repo')
    expect(execa).toHaveBeenCalledWith(
      'git',
      ['--no-pager', '-c', 'core.quotepath=false', 'diff', '--no-ext-diff', '--no-renames', '--stat', 'HEAD'],
      expect.anything(),
    )
  })

  it('serializes commands for the same cwd', async () => {
    const calls: number[] = []
    execa.mockImplementation(async () => {
      calls.push(calls.length + 1)
      await new Promise((r) => setTimeout(r, 10))
      return { stdout: '' }
    })
    const runner = new GitCommandRunner()
    const p1 = runner.run(['status'], '/repo')
    const p2 = runner.run(['log'], '/repo')
    await Promise.all([p1, p2])
    expect(calls).toEqual([1, 2])
  })

  it('allows parallel commands for different cwds', async () => {
    let active = 0
    let maxActive = 0
    execa.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return { stdout: '' }
    })
    const runner = new GitCommandRunner()
    await Promise.all([
      runner.run(['status'], '/repo1'),
      runner.run(['status'], '/repo2'),
    ])
    expect(maxActive).toBe(2)
  })

  it('classifies NOT_A_GIT_REPO', async () => {
    execa.mockRejectedValueOnce(new Error('fatal: not a git repository'))
    const runner = new GitCommandRunner()
    await expect(runner.run(['status'], '/not-git')).rejects.toMatchObject({
      code: 'NOT_A_GIT_REPO',
      args: ['status'],
      cwd: '/not-git',
    })
  })

  it('classifies MERGE_CONFLICT', async () => {
    execa.mockRejectedValueOnce(new Error('Automatic merge failed; fix conflicts'))
    const runner = new GitCommandRunner()
    const err = await runner.run(['merge', 'feature'], '/repo').catch((e) => e)
    expect(err).toBeInstanceOf(GitError)
    expect(err.code).toBe('MERGE_CONFLICT')
  })

  it('uses custom timeout', async () => {
    execa.mockResolvedValueOnce({ stdout: '' })
    const runner = new GitCommandRunner()
    await runner.run(['status'], '/repo', { timeout: 5000 })
    expect(execa).toHaveBeenCalledWith('git', expect.anything(), expect.objectContaining({ timeout: 5000 }))
  })
})
