import { useEffect } from 'react'
import { apiClient } from '@/shared/lib/api-client'
import { useWindowStore } from '@/shared/stores/window-store'
import { useWorkspaceStore } from '@/features/workspace/stores/workspace-store'
import type { Workspace } from '@akari/shared-types'

export function useWindowInit() {
  const workspaceId = useWindowStore(s => s.workspaceId)
  const setCurrentWorkspace = useWorkspaceStore(s => s.setCurrentWorkspace)

  // Load workspace metadata when the active workspaceId is known
  useEffect(() => {
    if (!workspaceId) return

    let cancelled = false

    async function init() {
      try {
        const workspace = await apiClient.get<Workspace>(`/workspaces/${workspaceId}`, { toast: false })
        if (cancelled) return
        setCurrentWorkspace(workspace)
        document.title = `${workspace.name} - Akari`
      } catch (err) {
        console.error('[useWindowInit] failed:', err)
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [workspaceId, setCurrentWorkspace])

  // Non-desktop web mode: if no workspaceId is in URL, redirect to the most recently active workspace
  useEffect(() => {
    if (workspaceId || typeof window === 'undefined' || window.electron) {
      return
    }

    let cancelled = false

    async function redirectToDefaultWorkspace() {
      try {
        const workspaces = await apiClient.get<Workspace[]>('/workspaces', { toast: false })
        if (cancelled || workspaces.length === 0) return
        const params = new URLSearchParams(window.location.search)
        params.set('workspaceId', workspaces[0].id)
        window.location.search = params.toString()
      } catch (err) {
        console.error('[useWindowInit] redirect failed:', err)
      }
    }

    void redirectToDefaultWorkspace()

    return () => {
      cancelled = true
    }
  }, [workspaceId])
}
