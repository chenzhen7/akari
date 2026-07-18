import { describe, it, expect, vi } from 'vitest'
import { getGitRoot } from './git-utils.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'

describe('getGitRoot', () => {
  it('returns normalized git root on success', async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: 'C:/projects/my-repo\n' } as any)
    const result = await getGitRoot('/some/cwd')
    expect(result).toBe('C:/projects/my-repo')
    expect(execa).toHaveBeenCalledWith(
      'git',
      ['-c', 'core.quotepath=false', 'rev-parse', '--show-toplevel'],
      { cwd: '/some/cwd' },
    )
  })

  it('converts backslashes to forward slashes', async () => {
    vi.mocked(execa).mockResolvedValueOnce({ stdout: 'C:\\projects\\my-repo\n' } as any)
    const result = await getGitRoot('/some/cwd')
    expect(result).toBe('C:/projects/my-repo')
  })

  it('returns null when git command fails', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('not a git repo'))
    const result = await getGitRoot('/not/git')
    expect(result).toBeNull()
  })

  it('returns null when git command throws non-Error', async () => {
    vi.mocked(execa).mockRejectedValueOnce('exit code 128')
    const result = await getGitRoot('/weird')
    expect(result).toBeNull()
  })
})
