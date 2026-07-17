import { useEffect } from 'react'
import { apiClient } from '@/lib/api-client'
import { useWindowStore } from '@/stores/window-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSessionStore } from '@/stores/session-store'
import type { Workspace, AgentSession } from '@akari/shared-types'

async function resolveWindowId(): Promise<number | null> {
  if (typeof window === 'undefined' || !window.electron?.workspace?.getWindowId) {
    return null
  }
  try {
    return await window.electron.workspace.getWindowId()
  } catch {
    return null
  }
}

export function useWindowInit() {
  const workspaceId = useWindowStore(s => s.workspaceId)
  const setWindowId = useWindowStore(s => s.setWindowId)
  const setCurrentWorkspace = useWorkspaceStore(s => s.setCurrentWorkspace)
  const setSessions = useSessionStore(s => s.setSessions)

  // Resolve window ID once on mount
  useEffect(() => {
    void resolveWindowId().then((id) => {
      if (id !== null) setWindowId(id)
    })
  }, [setWindowId])

  // Load workspace and sessions when the window's workspaceId is known
  useEffect(() => {
    if (!workspaceId) return

    let cancelled = false

    async function init() {
      try {
        const [workspace, sessions] = await Promise.all([
          apiClient.get<Workspace>(`/workspaces/${workspaceId}`, { toast: false }),
          apiClient.get<AgentSession[]>('/sessions', { toast: false }),
        ])
        if (cancelled) return
        setCurrentWorkspace(workspace)
        setSessions(sessions)
      } catch (err) {
        console.error('[useWindowInit] failed:', err)
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [workspaceId, setCurrentWorkspace, setSessions])
}
