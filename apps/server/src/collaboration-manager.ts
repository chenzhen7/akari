import { nanoid } from 'nanoid'
import type Database from 'better-sqlite3'
import type {
  AgentMessage,
  AgentSession,
  AgentType,
  CollaborationGroup,
  PipelineEdge,
  ServerMessage,
} from '@akari/shared-types'

export interface CollaborationManagerOpts {
  db: Database.Database
  broadcast: (msg: ServerMessage) => void
  createSession: (params: {
    name: string
    task: string
    baseBranch?: string
    agentType?: AgentType
    parentSessionId?: string
    groupId?: string
  }) => Promise<AgentSession>
  sendToTerminal: (sessionId: string, data: string) => void
  resumeSession: (sessionId: string) => void
}

interface AwaitEntry {
  waitingSessionId: string
  targetSessionId: string
  timeoutHandle: ReturnType<typeof setTimeout>
}

interface GroupRow {
  id: string
  name: string
  description: string | null
  status: string
  shared_context: string
  created_at: string
}

interface EdgeRow {
  id: string
  group_id: string
  from_session_id: string
  to_session_id: string
  trigger_type: string
  inject_context: number
  checkpoint_pattern: string | null
}

interface MessageRow {
  id: string
  group_id: string
  from_session_id: string
  to_session_id: string
  content: string
  created_at: string
}

export class CollaborationManager {
  private readonly db: Database.Database
  private readonly broadcast: (msg: ServerMessage) => void
  private readonly opts: CollaborationManagerOpts
  private readonly awaitEntries = new Map<string, AwaitEntry>()

  constructor(opts: CollaborationManagerOpts) {
    this.db = opts.db
    this.broadcast = opts.broadcast
    this.opts = opts
  }

  initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collaboration_groups (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        status         TEXT NOT NULL DEFAULT 'active',
        shared_context TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_sessions (
        group_id   TEXT NOT NULL REFERENCES collaboration_groups(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        PRIMARY KEY (group_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS pipeline_edges (
        id                 TEXT PRIMARY KEY,
        group_id           TEXT NOT NULL REFERENCES collaboration_groups(id) ON DELETE CASCADE,
        from_session_id    TEXT NOT NULL,
        to_session_id      TEXT NOT NULL,
        trigger_type       TEXT NOT NULL DEFAULT 'on-complete',
        inject_context     INTEGER NOT NULL DEFAULT 1,
        checkpoint_pattern TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_messages (
        id              TEXT PRIMARY KEY,
        group_id        TEXT NOT NULL,
        from_session_id TEXT NOT NULL,
        to_session_id   TEXT NOT NULL,
        content         TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );
    `)

    const migrateColumns: Array<[string, string]> = [
      ['collaboration_role', "TEXT NOT NULL DEFAULT 'standalone'"],
      ['group_id', 'TEXT'],
      ['parent_session_id', 'TEXT'],
      ['child_session_ids', "TEXT NOT NULL DEFAULT '[]'"],
    ]
    for (const [col, def] of migrateColumns) {
      try {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`)
      } catch {
        // Column already exists
      }
    }
  }

  // ─── Group CRUD ─────────────────────────────────────────────────────────────

  createGroup(name: string, description?: string): CollaborationGroup {
    const id = nanoid(8)
    const createdAt = new Date().toISOString()
    this.db
      .prepare('INSERT INTO collaboration_groups (id, name, description, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, description ?? null, createdAt)
    const group = this.getGroup(id)!
    this.broadcast({ event: 'collaboration:group-created', payload: group })
    return group
  }

  getGroup(id: string): CollaborationGroup | undefined {
    const row = this.db.prepare('SELECT * FROM collaboration_groups WHERE id = ?').get(id) as GroupRow | undefined
    if (!row) return undefined
    return this.rowToGroup(row)
  }

  listGroups(): CollaborationGroup[] {
    const rows = this.db
      .prepare('SELECT * FROM collaboration_groups ORDER BY created_at DESC')
      .all() as GroupRow[]
    return rows.map(r => this.rowToGroup(r))
  }

  updateGroup(id: string, updates: { name?: string; description?: string; status?: string }): void {
    if (updates.name !== undefined) {
      this.db.prepare('UPDATE collaboration_groups SET name = ? WHERE id = ?').run(updates.name, id)
    }
    if (updates.description !== undefined) {
      this.db.prepare('UPDATE collaboration_groups SET description = ? WHERE id = ?').run(updates.description, id)
    }
    if (updates.status !== undefined) {
      this.db.prepare('UPDATE collaboration_groups SET status = ? WHERE id = ?').run(updates.status, id)
    }
    const group = this.getGroup(id)
    if (group) this.broadcast({ event: 'collaboration:group-updated', payload: group })
  }

  deleteGroup(id: string): void {
    this.db.prepare('DELETE FROM collaboration_groups WHERE id = ?').run(id)
    this.broadcast({ event: 'collaboration:group-deleted', payload: { groupId: id } })
  }

  // ─── Session membership ──────────────────────────────────────────────────────

  addSessionToGroup(groupId: string, sessionId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO group_sessions (group_id, session_id) VALUES (?, ?)')
      .run(groupId, sessionId)
    this.db.prepare('UPDATE sessions SET group_id = ? WHERE id = ?').run(groupId, sessionId)
    const group = this.getGroup(groupId)
    if (group) this.broadcast({ event: 'collaboration:group-updated', payload: group })
  }

  removeSessionFromGroup(groupId: string, sessionId: string): void {
    this.db
      .prepare('DELETE FROM group_sessions WHERE group_id = ? AND session_id = ?')
      .run(groupId, sessionId)
    this.db.prepare('UPDATE sessions SET group_id = NULL WHERE id = ?').run(sessionId)
    const group = this.getGroup(groupId)
    if (group) this.broadcast({ event: 'collaboration:group-updated', payload: group })
  }

  getGroupForSession(sessionId: string): CollaborationGroup | undefined {
    const row = this.db
      .prepare('SELECT group_id FROM group_sessions WHERE session_id = ?')
      .get(sessionId) as { group_id: string } | undefined
    if (!row?.group_id) return undefined
    return this.getGroup(row.group_id)
  }

  // ─── Edge management ─────────────────────────────────────────────────────────

  addEdge(groupId: string, edge: Omit<PipelineEdge, 'id'>): PipelineEdge {
    const existing = this.getEdgesForGroup(groupId)
    const testEdges: PipelineEdge[] = [...existing, { ...edge, id: 'test' }]
    const cycle = this.detectCycle(testEdges)
    if (cycle) throw new Error(`Cycle detected: ${cycle.join(' → ')}`)

    const id = nanoid(8)
    this.db
      .prepare(
        'INSERT INTO pipeline_edges (id, group_id, from_session_id, to_session_id, trigger_type, inject_context, checkpoint_pattern) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        groupId,
        edge.fromSessionId,
        edge.toSessionId,
        edge.trigger,
        edge.injectContext ? 1 : 0,
        edge.checkpointPattern ?? null,
      )
    const group = this.getGroup(groupId)
    if (group) this.broadcast({ event: 'collaboration:group-updated', payload: group })
    return { id, ...edge }
  }

  removeEdge(groupId: string, edgeId: string): void {
    this.db.prepare('DELETE FROM pipeline_edges WHERE id = ? AND group_id = ?').run(edgeId, groupId)
    const group = this.getGroup(groupId)
    if (group) this.broadcast({ event: 'collaboration:group-updated', payload: group })
  }

  getEdgesForGroup(groupId: string): PipelineEdge[] {
    const rows = this.db
      .prepare('SELECT * FROM pipeline_edges WHERE group_id = ?')
      .all(groupId) as EdgeRow[]
    return rows.map(rowToEdge)
  }

  getAllEdgesForSession(sessionId: string): { edge: PipelineEdge; groupId: string }[] {
    const rows = this.db
      .prepare('SELECT * FROM pipeline_edges WHERE from_session_id = ? OR to_session_id = ?')
      .all(sessionId, sessionId) as EdgeRow[]
    return rows.map(r => ({ edge: rowToEdge(r), groupId: r.group_id }))
  }

  validateDAG(groupId: string): { valid: boolean; cycle?: string[] } {
    const edges = this.getEdgesForGroup(groupId)
    const cycle = this.detectCycle(edges)
    return cycle ? { valid: false, cycle } : { valid: true }
  }

  // ─── Pipeline triggers ───────────────────────────────────────────────────────

  async onSessionCompleted(sessionId: string, summary?: string): Promise<void> {
    this.resolveAwaiters(sessionId, summary ?? '')

    const edgeRows = this.db
      .prepare(
        "SELECT * FROM pipeline_edges WHERE from_session_id = ? AND trigger_type = 'on-complete'",
      )
      .all(sessionId) as EdgeRow[]

    for (const edgeRow of edgeRows) {
      const edge = rowToEdge(edgeRow)

      const allPredecessors = this.db
        .prepare(
          "SELECT from_session_id FROM pipeline_edges WHERE to_session_id = ? AND trigger_type = 'on-complete'",
        )
        .all(edge.toSessionId) as Array<{ from_session_id: string }>

      const allDone = allPredecessors.every(pred => {
        const row = this.db
          .prepare('SELECT status FROM sessions WHERE id = ?')
          .get(pred.from_session_id) as { status: string } | undefined
        return row && ['completed', 'merged', 'archived'].includes(row.status)
      })

      if (!allDone) continue

      const contextMsg = edge.injectContext && summary
        ? `\r\n\x1b[36m[Pipeline Context from ${sessionId}]\x1b[0m\r\n${summary.slice(0, 800)}\r\n`
        : undefined

      if (contextMsg) {
        this.opts.sendToTerminal(edge.toSessionId, contextMsg)
        this.broadcast({
          event: 'terminal:data',
          payload: { sessionId: edge.toSessionId, data: contextMsg },
        })
      }

      this.broadcast({
        event: 'collaboration:pipeline-triggered',
        payload: { edgeId: edge.id, fromId: sessionId, toId: edge.toSessionId },
      })
    }
  }

  async onSessionCheckpoint(sessionId: string, description: string): Promise<void> {
    const edgeRows = this.db
      .prepare(
        "SELECT * FROM pipeline_edges WHERE from_session_id = ? AND trigger_type = 'on-checkpoint'",
      )
      .all(sessionId) as EdgeRow[]

    for (const edgeRow of edgeRows) {
      const { checkpoint_pattern, to_session_id, id: edgeId } = edgeRow
      if (!checkpoint_pattern || description.toLowerCase().includes(checkpoint_pattern.toLowerCase())) {
        const msg = `\r\n\x1b[36m[Pipeline Checkpoint from ${sessionId}: ${description}]\x1b[0m\r\n`
        this.opts.sendToTerminal(to_session_id, msg)
        this.broadcast({ event: 'terminal:data', payload: { sessionId: to_session_id, data: msg } })
        this.broadcast({
          event: 'collaboration:pipeline-triggered',
          payload: { edgeId, fromId: sessionId, toId: to_session_id },
        })
      }
    }
  }

  // ─── Shared context ──────────────────────────────────────────────────────────

  updateSharedContext(groupId: string, context: string): void {
    this.db
      .prepare('UPDATE collaboration_groups SET shared_context = ? WHERE id = ?')
      .run(context, groupId)
    this.broadcast({ event: 'collaboration:context-updated', payload: { groupId, context } })
  }

  getSharedContext(groupId: string): string {
    const row = this.db
      .prepare('SELECT shared_context FROM collaboration_groups WHERE id = ?')
      .get(groupId) as { shared_context: string } | undefined
    return row?.shared_context ?? ''
  }

  // ─── Agent messages ──────────────────────────────────────────────────────────

  routeAgentMessage(groupId: string, fromSessionId: string, toSessionId: string, content: string): void {
    const id = nanoid(8)
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO agent_messages (id, group_id, from_session_id, to_session_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, groupId, fromSessionId, toSessionId, content, now)
    const msg: AgentMessage = {
      id,
      groupId,
      fromSessionId,
      toSessionId,
      content,
      timestamp: new Date(now),
    }
    this.broadcast({ event: 'agent:message', payload: msg })
  }

  getMessages(groupId: string, limit = 100): AgentMessage[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM agent_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(groupId, limit) as MessageRow[]
    return rows.reverse().map(r => ({
      id: r.id,
      groupId: r.group_id,
      fromSessionId: r.from_session_id,
      toSessionId: r.to_session_id,
      content: r.content,
      timestamp: new Date(r.created_at),
    }))
  }

  // ─── Spawn & Delegate ────────────────────────────────────────────────────────

  async handleSpawnAgent(
    parentSessionId: string,
    params: { task: string; agentType: AgentType; branch?: string },
  ): Promise<void> {
    const group = this.getGroupForSession(parentSessionId)
    const parentRow = this.db
      .prepare('SELECT base_branch FROM sessions WHERE id = ?')
      .get(parentSessionId) as { base_branch: string } | undefined

    const newSession = await this.opts.createSession({
      name: `Worker: ${params.task.slice(0, 30)}`,
      task: params.task,
      baseBranch: params.branch ?? parentRow?.base_branch ?? 'main',
      agentType: params.agentType,
      parentSessionId,
      groupId: group?.id,
    })

    this.db
      .prepare("UPDATE sessions SET parent_session_id = ?, collaboration_role = 'worker' WHERE id = ?")
      .run(parentSessionId, newSession.id)

    const parentChildRow = this.db
      .prepare('SELECT child_session_ids FROM sessions WHERE id = ?')
      .get(parentSessionId) as { child_session_ids: string } | undefined
    const childIds: string[] = JSON.parse(parentChildRow?.child_session_ids ?? '[]')
    childIds.push(newSession.id)
    this.db
      .prepare('UPDATE sessions SET child_session_ids = ? WHERE id = ?')
      .run(JSON.stringify(childIds), parentSessionId)

    if (group) {
      this.addSessionToGroup(group.id, newSession.id)
    }

    this.broadcast({
      event: 'collaboration:agent-spawned',
      payload: { parentSessionId, newSession },
    })
  }

  handleDelegate(fromSessionId: string, toSessionId: string, message: string): void {
    const group = this.getGroupForSession(fromSessionId)
    if (group) {
      this.routeAgentMessage(group.id, fromSessionId, toSessionId, message)
    }
    const injected = `\r\n\x1b[36m[Message from ${fromSessionId}]\x1b[0m ${message}\r\n`
    this.opts.sendToTerminal(toSessionId, injected)
    this.broadcast({ event: 'terminal:data', payload: { sessionId: toSessionId, data: injected } })
  }

  // ─── Await session ───────────────────────────────────────────────────────────

  registerAwait(waitingSessionId: string, targetSessionId: string, timeoutSeconds: number): void {
    const key = `${waitingSessionId}:${targetSessionId}`
    const existing = this.awaitEntries.get(key)
    if (existing) clearTimeout(existing.timeoutHandle)

    const timeoutHandle = setTimeout(() => {
      this.awaitEntries.delete(key)
      const msg = `\r\n\x1b[33m[TIMEOUT] Session ${targetSessionId} did not complete within ${timeoutSeconds}s\x1b[0m\r\n`
      this.opts.sendToTerminal(waitingSessionId, msg)
      this.broadcast({ event: 'terminal:data', payload: { sessionId: waitingSessionId, data: msg } })
      try {
        this.opts.resumeSession(waitingSessionId)
      } catch {
        // Session may already be in a non-resumable state
      }
    }, timeoutSeconds * 1000)

    this.awaitEntries.set(key, { waitingSessionId, targetSessionId, timeoutHandle })
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private resolveAwaiters(targetSessionId: string, summary: string): void {
    for (const [key, entry] of this.awaitEntries) {
      if (entry.targetSessionId === targetSessionId) {
        clearTimeout(entry.timeoutHandle)
        this.awaitEntries.delete(key)
        const msg = `\r\n\x1b[36m[RESULT from ${targetSessionId}]\x1b[0m\r\n${summary.slice(0, 600)}\r\n`
        this.opts.sendToTerminal(entry.waitingSessionId, msg)
        this.broadcast({ event: 'terminal:data', payload: { sessionId: entry.waitingSessionId, data: msg } })
        try {
          this.opts.resumeSession(entry.waitingSessionId)
        } catch {
          // ignore
        }
      }
    }
  }

  private detectCycle(edges: PipelineEdge[]): string[] | null {
    const graph = new Map<string, string[]>()
    for (const e of edges) {
      if (!graph.has(e.fromSessionId)) graph.set(e.fromSessionId, [])
      graph.get(e.fromSessionId)!.push(e.toSessionId)
    }

    const visited = new Set<string>()
    const inStack = new Set<string>()
    const path: string[] = []

    const dfs = (node: string): boolean => {
      if (inStack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      inStack.add(node)
      path.push(node)
      for (const neighbor of graph.get(node) ?? []) {
        if (dfs(neighbor)) return true
      }
      path.pop()
      inStack.delete(node)
      return false
    }

    for (const node of graph.keys()) {
      if (dfs(node)) return [...path]
    }
    return null
  }

  private rowToGroup(row: GroupRow): CollaborationGroup {
    const sessions = this.db
      .prepare('SELECT session_id FROM group_sessions WHERE group_id = ?')
      .all(row.id) as Array<{ session_id: string }>
    const edges = this.getEdgesForGroup(row.id)
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      sessionIds: sessions.map(s => s.session_id),
      pipelineEdges: edges,
      sharedContext: row.shared_context,
      status: row.status as CollaborationGroup['status'],
      createdAt: new Date(row.created_at),
    }
  }
}

function rowToEdge(r: EdgeRow): PipelineEdge {
  return {
    id: r.id,
    fromSessionId: r.from_session_id,
    toSessionId: r.to_session_id,
    trigger: r.trigger_type as PipelineEdge['trigger'],
    injectContext: r.inject_context === 1,
    checkpointPattern: r.checkpoint_pattern ?? undefined,
  }
}
