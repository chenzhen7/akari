import 'fastify'
import type Database from 'better-sqlite3'
import type { ServerMessage } from '@akari/shared-types'
import type { SessionManager } from '../session-manager.js'
import type { WorkspaceService } from '../services/workspace.service.js'
import type { CanvasEdgeStore } from '../infrastructure/db/canvas-edge-store.js'
import type { WorkspaceSessionRegistryService } from '../services/workspace-session-registry.service.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database
    workspaceManager: WorkspaceService
    canvasEdgeStore: CanvasEdgeStore
    clients: Set<WebSocket>
    workspaceClients: Map<WebSocket, string>
    broadcast: (msg: ServerMessage, workspaceId?: string) => void
    getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
    workspaceSessionRegistry: WorkspaceSessionRegistryService
  }

  interface FastifyRequest {
    workspaceId?: string
    sessionManager: SessionManager
  }
}
