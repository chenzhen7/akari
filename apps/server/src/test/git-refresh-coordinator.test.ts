import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { GitRefreshCoordinator } from '../services/git-refresh-coordinator.service.js'
import type { IWorktreeService } from '../services/worktree.service.js'
import type { GitDiff } from '@akari/shared-types'

const REPO = resolve('/repo')

const getCurrentDiff = vi.fn()
const getGitLog = vi.fn()
const invalidateDiffCache = vi.fn()
const invalidateGitLogCache = vi.fn()
const worktreeService = {
  getCurrentDiff,
  getGitLog,
  invalidateDiffCache,
  invalidateGitLogCache,
} as unknown as IWorktreeService

const persistDiffSummary = vi.fn()
const broadcast = vi.fn()

const EMPTY_DIFF: GitDiff = { files: [], summary: { additions: 0, deletions: 0, files: 0 } }

let coordinator: GitRefreshCoordinator

describe('GitRefreshCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCurrentDiff.mockReset()
    getGitLog.mockReset()
    invalidateDiffCache.mockReset()
    invalidateGitLogCache.mockReset()
    persistDiffSummary.mockReset()
    broadcast.mockReset()
    getCurrentDiff.mockResolvedValue(EMPTY_DIFF)
    getGitLog.mockResolvedValue({ commits: [], branches: [], head: '' })
    coordinator = new GitRefreshCoordinator(worktreeService, persistDiffSummary, broadcast)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces multiple changeList schedules into a single refresh', async () => {
    coordinator.scheduleChangeList('s1', REPO)
    coordinator.scheduleChangeList('s1', REPO)
    coordinator.scheduleChangeList('s1', REPO)
    await vi.advanceTimersByTimeAsync(250)
    expect(getCurrentDiff).toHaveBeenCalledTimes(1)
    expect(persistDiffSummary).toHaveBeenCalledWith('s1', { additions: 0, deletions: 0, files: 0 })
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'diff:update', payload: { sessionId: 's1', diff: EMPTY_DIFF } }),
    )
    // 未触发 git log 刷新（Agent 写文件只刷列表，图不动）
    expect(getGitLog).not.toHaveBeenCalled()
  })

  it('changeList-only schedule does not touch git log cache or broadcast', async () => {
    coordinator.scheduleChangeList('s1', REPO)
    await vi.advanceTimersByTimeAsync(250)
    expect(invalidateDiffCache).toHaveBeenCalledWith(REPO)
    expect(invalidateGitLogCache).not.toHaveBeenCalled()
    expect(getGitLog).not.toHaveBeenCalled()
  })

  it('scheduleFullRefresh runs changeList then git log', async () => {
    coordinator.scheduleFullRefresh('s1', REPO)
    await vi.advanceTimersByTimeAsync(250)
    expect(getCurrentDiff).toHaveBeenCalledTimes(1)
    expect(invalidateGitLogCache).toHaveBeenCalledWith(REPO)
    expect(getGitLog).toHaveBeenCalledTimes(1)
    expect(getGitLog).toHaveBeenCalledWith(REPO, 100, 0)
    // diff:update + git:log-updated 各一次
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ event: 'diff:update' }))
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'git:log-updated', payload: { sessionId: 's1', commits: [], branches: [], head: '' } }),
    )
  })

  it('schedules while a refresh is in flight → runs once more (trailing)', async () => {
    // 第一次 getCurrentDiff 挂起，让刷新「卡」在 in-flight；后续调用立即 resolve
    let release: () => void = () => {}
    getCurrentDiff.mockImplementationOnce(() => new Promise<GitDiff>((r) => { release = () => r(EMPTY_DIFF) }))
    getCurrentDiff.mockResolvedValue(EMPTY_DIFF)

    coordinator.scheduleChangeList('s1', REPO)
    await vi.advanceTimersByTimeAsync(250) // flush 启动，getCurrentDiff 挂起
    coordinator.scheduleChangeList('s1', REPO) // 在跑期间又有新事件
    release() // 放行第一次刷新
    await vi.runAllTimersAsync()

    expect(getCurrentDiff).toHaveBeenCalledTimes(2)
    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it('treats different paths as independent refresh entries', async () => {
    coordinator.scheduleChangeList('s1', '/repoA')
    coordinator.scheduleChangeList('s1', '/repoB')
    await vi.advanceTimersByTimeAsync(250)
    expect(getCurrentDiff).toHaveBeenCalledTimes(2)
    expect(broadcast).toHaveBeenCalledTimes(2)
  })

  it('logs warn (not throws) when refresh fails', async () => {
    getCurrentDiff.mockRejectedValue(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    coordinator.scheduleChangeList('s1', REPO)
    await vi.advanceTimersByTimeAsync(250)
    // 失败不上抛、不广播，但记 warn 日志（禁止吞异常）
    expect(broadcast).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
