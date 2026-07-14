import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type { CanvasEdge } from '@akari/shared-types'

interface CanvasEdgeRow {
  id: string
  source_session_id: string
  target_session_id: string
  trigger_type: string
  inject_context: number
  created_at: string
}

function rowToEdge(r: CanvasEdgeRow): CanvasEdge {
  return {
    id: r.id,
    sourceSessionId: r.source_session_id,
    targetSessionId: r.target_session_id,
    trigger: r.trigger_type as CanvasEdge['trigger'],
    injectContext: r.inject_context === 1,
  }
}

export class CanvasEdgeRepository {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    this.initDb()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_edges (
        id                  TEXT PRIMARY KEY,
        source_session_id  TEXT NOT NULL,
        target_session_id  TEXT NOT NULL,
        trigger_type       TEXT NOT NULL DEFAULT 'on-complete',
        inject_context     INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT NOT NULL
      )
    `)
  }

  create(params: {
    sourceSessionId: string
    targetSessionId: string
    trigger?: 'on-complete'
    injectContext?: boolean
  }): CanvasEdge {
    const id = nanoid(8)
    const createdAt = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO canvas_edges (id, source_session_id, target_session_id, trigger_type, inject_context, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        params.sourceSessionId,
        params.targetSessionId,
        params.trigger ?? 'on-complete',
        params.injectContext !== false ? 1 : 0,
        createdAt,
      )
    return {
      id,
      sourceSessionId: params.sourceSessionId,
      targetSessionId: params.targetSessionId,
      trigger: params.trigger ?? 'on-complete',
      injectContext: params.injectContext !== false,
    }
  }

  delete(edgeId: string): boolean {
    const info = this.db.prepare('DELETE FROM canvas_edges WHERE id = ?').run(edgeId)
    return info.changes > 0
  }

  getAll(): CanvasEdge[] {
    const rows = this.db
      .prepare('SELECT * FROM canvas_edges ORDER BY created_at ASC')
      .all() as CanvasEdgeRow[]
    return rows.map(rowToEdge)
  }

  getEdgesForSession(sessionId: string): CanvasEdge[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM canvas_edges WHERE source_session_id = ? OR target_session_id = ? ORDER BY created_at ASC',
      )
      .all(sessionId, sessionId) as CanvasEdgeRow[]
    return rows.map(rowToEdge)
  }
}
