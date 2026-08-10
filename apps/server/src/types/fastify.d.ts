import 'fastify'
import type Database from 'better-sqlite3'
import type { ServerMessage, Workspace } from '@akari/shared-types'
import type { SessionManager } from '../session-manager.js'
import type { WorkspaceService } from '../services/workspace.service.js'
import type { CanvasEdgeStore } from '../infrastructure/db/canvas-edge-store.js'
import type { WorkspaceSessionRegistryService } from '../services/workspace-session-registry.service.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database
    workspaceManager: WorkspaceService
    canvasEdgeStore: CanvasEdgeStore
    /** 单窗口 WS 状态：当前唯一连接及其订阅的工作区。 */
    wsState: {
      socket: WebSocket | null
      workspaceId: string | null
    }
    broadcast: (msg: ServerMessage, workspaceId?: string) => void
    getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
    syncWorkspaceGitState: (workspace: Workspace) => Promise<Workspace>
    workspaceSessionRegistry: WorkspaceSessionRegistryService
  }

  interface FastifyRequest {
    workspaceId?: string
    sessionManager: SessionManager
  }
}
