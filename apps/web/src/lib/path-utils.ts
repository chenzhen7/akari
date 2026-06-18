import type { AgentSession, Workspace } from '@akari/shared-types'

export function resolveAbsoluteFilePath(
  session: AgentSession,
  filePath: string,
  workspace: Workspace | null,
): string {
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  if (!workspace) {
    return `${session.worktreePath.replace(/\\/g, '/')}/${normalizedFilePath}`
  }

  const repoRoot = workspace.repoRoot.replace(/\\/g, '/')
  const workspacePath = workspace.path.replace(/\\/g, '/')
  const worktreePath = session.worktreePath.replace(/\\/g, '/')

  // Agent sessions: worktreePath is a full checkout of the repo root.
  if (worktreePath !== workspacePath) {
    return `${worktreePath}/${normalizedFilePath}`
  }

  // Main session: workspacePath may be a subdirectory of the git root.
  const offset = repoRoot === workspacePath ? '' : workspacePath.slice(repoRoot.length + 1)
  if (offset && (normalizedFilePath === offset || normalizedFilePath.startsWith(offset + '/'))) {
    return `${repoRoot}/${normalizedFilePath}`
  }
  return `${workspacePath}/${normalizedFilePath}`
}
