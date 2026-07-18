import { describe, it, expect } from 'vitest'
import { resolveAbsoluteFilePath } from './path-utils'
import type { Workspace } from '@akari/shared-types'

describe('resolveAbsoluteFilePath', () => {
  it('joins worktree path when no workspace provided', () => {
    const result = resolveAbsoluteFilePath('/worktrees/repo/session', 'src/main.ts', null)
    expect(result).toBe('/worktrees/repo/session/src/main.ts')
  })

  it('joins agent worktree path when different from workspace path', () => {
    const workspace: Workspace = {
      id: 'ws-1',
      name: 'Repo',
      path: '/projects/repo',
      repoRoot: '/projects/repo',
      isGit: true,
      createdAt: new Date(),
      lastOpenedAt: new Date(),
    }
    const result = resolveAbsoluteFilePath('/worktrees/repo/session', 'src/main.ts', workspace)
    expect(result).toBe('/worktrees/repo/session/src/main.ts')
  })

  it('uses repo root for main session when workspace is a subdirectory', () => {
    const workspace: Workspace = {
      id: 'ws-1',
      name: 'Sub',
      path: '/projects/repo/apps/web',
      repoRoot: '/projects/repo',
      isGit: true,
      createdAt: new Date(),
      lastOpenedAt: new Date(),
    }
    const result = resolveAbsoluteFilePath('/projects/repo/apps/web', 'apps/web/src/main.ts', workspace)
    expect(result).toBe('/projects/repo/apps/web/src/main.ts')
  })

  it('uses workspace path for main session when file is outside offset', () => {
    const workspace: Workspace = {
      id: 'ws-1',
      name: 'Sub',
      path: '/projects/repo/apps/web',
      repoRoot: '/projects/repo',
      isGit: true,
      createdAt: new Date(),
      lastOpenedAt: new Date(),
    }
    const result = resolveAbsoluteFilePath('/projects/repo/apps/web', ' unrelated.md', workspace)
    expect(result).toBe('/projects/repo/apps/web/ unrelated.md')
  })

  it('normalizes backslashes to forward slashes', () => {
    const result = resolveAbsoluteFilePath('C:\\worktrees\\repo\\session', 'src\\main.ts', null)
    expect(result).toBe('C:/worktrees/repo/session/src/main.ts')
  })
})
