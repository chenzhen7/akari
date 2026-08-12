import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitRepository } from '../infrastructure/git/git-repository.js'
import type { GitCommandRunner } from '../infrastructure/git/git-command-runner.js'

const runRead = vi.fn()
const run = vi.fn()
const runner = { runRead, run } as unknown as GitCommandRunner

const MAX_CHANGE_FILES = 20000

let tmpDir: string

describe('GitRepository', () => {
  beforeEach(() => {
    runRead.mockReset()
    run.mockReset()
    tmpDir = mkdtempSync(join(tmpdir(), 'git-repo-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('caches current branch', async () => {
    runRead.mockResolvedValueOnce('main\n')
    const repo = new GitRepository('/repo', runner)
    const first = await repo.getCurrentBranch()
    const second = await repo.getCurrentBranch()
    expect(first).toBe('main')
    expect(second).toBe('main')
    expect(runRead).toHaveBeenCalledTimes(1)
  })

  it('returns main when git fails', async () => {
    runRead.mockRejectedValueOnce(new Error('not a git repo'))
    const repo = new GitRepository('/repo', runner)
    expect(await repo.getCurrentBranch()).toBe('main')
  })

  it('invalidates repo cache', async () => {
    runRead.mockResolvedValueOnce('main\n')
    const repo = new GitRepository('/repo', runner)
    await repo.getCurrentBranch()
    repo.invalidateRepoCache()
    runRead.mockResolvedValueOnce('feature\n')
    expect(await repo.getCurrentBranch()).toBe('feature')
    expect(runRead).toHaveBeenCalledTimes(2)
  })

  it('computes and caches change list with exactly 2 commands', async () => {
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return Promise.resolve(' M foo.ts\0')
      if (args[0] === 'diff') return Promise.resolve('2\t1\tfoo.ts\0')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const diff1 = await repo.getDiff()
    const diff2 = await repo.getDiff()
    expect(diff1.files).toEqual([{ path: 'foo.ts', status: 'M', additions: 2, deletions: 1 }])
    expect(diff1.summary).toEqual({ additions: 2, deletions: 1, files: 1 })
    expect(diff2).toBe(diff1)
    // changeList = status + numstat 两条只读命令；缓存命中不再发命令
    expect(runRead).toHaveBeenCalledTimes(2)
  })

  it('clears diff cache on invalidateDiffCache', async () => {
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return Promise.resolve(' M foo.ts\0')
      if (args[0] === 'diff') return Promise.resolve('2\t1\tfoo.ts\0')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    await repo.getDiff()
    repo.invalidateDiffCache()
    await repo.getDiff()
    expect(runRead).toHaveBeenCalledTimes(4)
  })

  it('parses rename attribution (new path first, additions from new, deletions from old)', async () => {
    // porcelain -z：`R  new.ts\0old.ts\0`；numstat --no-renames 拆成 A/D 两条
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return Promise.resolve('R  new.ts\0old.ts\0')
      if (args[0] === 'diff') return Promise.resolve('4\t0\tnew.ts\0' + '0\t3\told.ts\0')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const diff = await repo.getDiff()
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toEqual({ path: 'new.ts', status: 'R', additions: 4, deletions: 3 })
    expect(diff.summary).toEqual({ additions: 4, deletions: 3, files: 1 })
  })

  it('counts untracked file lines via fs without spawning git', async () => {
    writeFileSync(join(tmpDir, 'untracked.txt'), 'a\nb\nc\n')
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return Promise.resolve('?? untracked.txt\0')
      if (args[0] === 'diff') return Promise.resolve('')
      return Promise.resolve('')
    })
    const repo = new GitRepository(tmpDir, runner)
    const diff = await repo.getDiff()
    expect(diff.files).toEqual([{ path: 'untracked.txt', status: 'A', additions: 3, deletions: 0 }])
    expect(diff.summary.additions).toBe(3)
    // 未跟踪文件数行不 spawn git，仍是 status + numstat 两条
    expect(runRead).toHaveBeenCalledTimes(2)
  })

  it('skips binary untracked files (count 0)', async () => {
    writeFileSync(join(tmpDir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return Promise.resolve('?? bin.dat\0')
      if (args[0] === 'diff') return Promise.resolve('')
      return Promise.resolve('')
    })
    const repo = new GitRepository(tmpDir, runner)
    const diff = await repo.getDiff()
    expect(diff.files[0]).toMatchObject({ path: 'bin.dat', status: 'A', additions: 0 })
  })

  it('truncates change list at max files', async () => {
    const entries = Array.from({ length: MAX_CHANGE_FILES + 5 }, (_, i) => ` M file${i}.ts\0`).join('')
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return Promise.resolve(entries)
      if (args[0] === 'diff') return Promise.resolve('')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const diff = await repo.getDiff()
    expect(diff.truncated).toBe(true)
    expect(diff.files).toHaveLength(MAX_CHANGE_FILES)
    expect(diff.summary.files).toBe(MAX_CHANGE_FILES)
  })

  it('returns diff lines for an untracked file via --no-index exit-1 stdout', async () => {
    // 未跟踪文件：diff HEAD 为空 → cat-file 失败（exit 128）→ 回退 --no-index（exit 1 = 有差异）
    const diffOut =
      'diff --git a/new.txt b/new.txt\n' +
      'new file mode 100644\n' +
      '--- /dev/null\n' +
      '+++ b/new.txt\n' +
      '@@ -0,0 +1 @@\n' +
      '+hello\n'
    const reject = (code: number, stdout = '') => {
      const err = Object.assign(new Error(`exit ${code}`), { exitCode: code, stdout })
      return Promise.reject(err)
    }
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'cat-file') return reject(128)
      if (args[0] === 'diff' && args.includes('--no-index')) return reject(1, diffOut)
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const lines = await repo.getFileDiffLines('new.txt')
    expect(lines).toEqual([{ type: 'added', lineNumber: 1 }])
  })

  it('returns hunks for an untracked file via --no-index exit-1 stdout', async () => {
    const diffOut =
      'diff --git a/new.txt b/new.txt\n' +
      'new file mode 100644\n' +
      '--- /dev/null\n' +
      '+++ b/new.txt\n' +
      '@@ -0,0 +1 @@\n' +
      '+hello\n'
    const reject = (code: number, stdout = '') => {
      const err = Object.assign(new Error(`exit ${code}`), { exitCode: code, stdout })
      return Promise.reject(err)
    }
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'cat-file') return reject(128)
      if (args[0] === 'diff' && args.includes('--no-index')) return reject(1, diffOut)
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const hunks = await repo.getFileDiffHunks('new.txt')
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.additions).toBe(1)
    expect(hunks[0]!.lines).toEqual([{ type: 'added', content: 'hello', newLineNumber: 1 }])
  })

  it('returns original file content from HEAD', async () => {
    runRead.mockResolvedValueOnce('original content')
    const repo = new GitRepository('/repo', runner)
    const result = await repo.getFileDiffContent('foo.ts')
    expect(result.original).toBe('original content')
    expect(runRead).toHaveBeenCalledWith(['show', 'HEAD:foo.ts'], '/repo')
  })

  it('parses git log output and caches within TTL', async () => {
    runRead.mockImplementation((args: string[]) => {
      if (args[0] === 'log') {
        return Promise.resolve('hash1||short1||msg||author||email||2024-01-01T00:00:00Z|| ||HEAD -> main')
      }
      if (args[0] === 'rev-parse') return Promise.resolve('hash1\n')
      if (args[0] === 'branch') return Promise.resolve('* main|hash1|*')
      return Promise.resolve('')
    })
    const repo = new GitRepository('/repo', runner)
    const log1 = await repo.getGitLog(10, 0)
    const log2 = await repo.getGitLog(10, 0)
    expect(log1.commits).toHaveLength(1)
    expect(log1.commits[0].hash).toBe('hash1')
    expect(log1.head).toBe('hash1')
    // 3 条只读命令（log + rev-parse + branch）真并行一次，第二次命中 TTL 缓存
    expect(runRead).toHaveBeenCalledTimes(3)
  })
})
