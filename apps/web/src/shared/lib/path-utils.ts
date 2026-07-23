import type { Workspace } from '@akari/shared-types'

export function resolveAbsoluteFilePath(
  worktreePath: string,
  filePath: string,
  workspace: Workspace | null,
): string {
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  const normalizedWorktreePath = worktreePath.replace(/\\/g, '/')

  if (!workspace) {
    return `${normalizedWorktreePath}/${normalizedFilePath}`
  }

  const repoRoot = workspace.repoRoot.replace(/\\/g, '/')
  const workspacePath = workspace.path.replace(/\\/g, '/')

  // Agent sessions: worktreePath is a full checkout of the repo root.
  if (normalizedWorktreePath !== workspacePath) {
    return `${normalizedWorktreePath}/${normalizedFilePath}`
  }

  // Main session: workspacePath may be a subdirectory of the git root.
  const offset = repoRoot === workspacePath ? '' : workspacePath.slice(repoRoot.length + 1)
  if (offset && (normalizedFilePath === offset || normalizedFilePath.startsWith(offset + '/'))) {
    return `${repoRoot}/${normalizedFilePath}`
  }
  return `${workspacePath}/${normalizedFilePath}`
}
