import { describe, it, expect, vi } from 'vitest'
import { SettingsStore } from './settings-store.js'
import { SettingsRepository } from './db/repositories/settings.repository.js'

vi.mock('./db/repositories/settings.repository.js', () => ({
  SettingsRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn().mockReturnValue({}),
  })),
}))

describe('SettingsStore', () => {
  it('returns default worktree base dir when not configured', () => {
    const store = new SettingsStore({} as any)
    expect(store.getWorktreeBaseDir()).toMatch(/\.akari[\\/]worktrees$/)
  })

  it('returns configured worktree base dir', () => {
    const mockRepository = {
      get: vi.fn().mockReturnValue('/custom/worktrees'),
      set: vi.fn(),
      getAll: vi.fn().mockReturnValue({}),
    }
    vi.mocked(SettingsRepository).mockImplementationOnce(() => mockRepository as any)

    const store = new SettingsStore({} as any)
    expect(store.getWorktreeBaseDir()).toBe('/custom/worktrees')
    expect(mockRepository.get).toHaveBeenCalledWith('worktree.baseDir')
  })

  it('persists worktree base dir', () => {
    const mockRepository = {
      get: vi.fn(),
      set: vi.fn(),
      getAll: vi.fn().mockReturnValue({}),
    }
    vi.mocked(SettingsRepository).mockImplementationOnce(() => mockRepository as any)

    const store = new SettingsStore({} as any)
    store.setWorktreeBaseDir('/new/path')
    expect(mockRepository.set).toHaveBeenCalledWith('worktree.baseDir', '/new/path')
  })

  it('delegates get/set/getAll to repository', () => {
    const mockRepository = {
      get: vi.fn().mockReturnValue('value'),
      set: vi.fn(),
      getAll: vi.fn().mockReturnValue({ key: 'value' }),
    }
    vi.mocked(SettingsRepository).mockImplementationOnce(() => mockRepository as any)

    const store = new SettingsStore({} as any)
    expect(store.get('key')).toBe('value')
    expect(mockRepository.get).toHaveBeenCalledWith('key')

    store.set('key', 'new')
    expect(mockRepository.set).toHaveBeenCalledWith('key', 'new')

    expect(store.getAll()).toEqual({ key: 'value' })
    expect(mockRepository.getAll).toHaveBeenCalled()
  })
})
