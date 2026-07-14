import type Database from 'better-sqlite3'
import type { CanvasEdge } from '@akari/shared-types'
import { CanvasEdgeRepository } from './db/repositories/canvas-edge.repository.js'

export class CanvasEdgeStore {
  private readonly repository: CanvasEdgeRepository

  constructor(db: Database.Database) {
    this.repository = new CanvasEdgeRepository(db)
  }

  createEdge(params: {
    sourceSessionId: string
    targetSessionId: string
    trigger?: 'on-complete'
    injectContext?: boolean
  }): CanvasEdge {
    return this.repository.create(params)
  }

  deleteEdge(edgeId: string): boolean {
    return this.repository.delete(edgeId)
  }

  getAllEdges(): CanvasEdge[] {
    return this.repository.getAll()
  }

  getEdgesForSession(sessionId: string): CanvasEdge[] {
    return this.repository.getEdgesForSession(sessionId)
  }
}
