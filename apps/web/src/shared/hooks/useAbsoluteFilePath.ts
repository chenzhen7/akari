import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import { resolveAbsoluteFilePath } from '@/shared/lib/path-utils'
import { useShallow } from 'zustand/react/shallow'

export function useAbsoluteFilePath(
  worktreePath: string,
  filePath: string,
  workspaceId: string,
): string {
  const workspace = useWorkspaceStore(
    useShallow(s => s.workspaces.find(w => w.id === workspaceId) ?? null),
  )
  return resolveAbsoluteFilePath(worktreePath, filePath, workspace)
}
