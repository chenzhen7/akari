import 'fastify'
import type Database from 'better-sqlite3'
import type { ServerMessage } from '@akari/shared-types'
import type { SessionManager } from '../session-manager.js'
import type { WorkspaceManager } from '../workspace-manager.js'
import type { CanvasEdgeStore } from '../canvas-edge-store.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database
    workspaceManager: WorkspaceManager
    sessionManager: SessionManager
    canvasEdgeStore: CanvasEdgeStore
    clients: Set<WebSocket>
    workspaceClients: Map<WebSocket, string>
    broadcast: (msg: ServerMessage, workspaceId?: string) => void
    getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
  }

  interface FastifyRequest {
    workspaceId?: string
    sessionManager: SessionManager
  }
}
