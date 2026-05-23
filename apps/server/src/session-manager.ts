import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { mkdir, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  AgentSession,
  AgentType,
  ApprovalRequest,
  GitDiff,
  KanbanColumn,
  ServerMessage,
  SessionStatus,
} from '@akari/shared-types'
import { WorktreeManager } from './worktree-manager.js'
import { TerminalMultiplexer } from './terminal-mux.js'

export interface CreateSessionParams {
  name: string
  task: string
  baseBranch?: string
  agentType?: AgentType
  tags?: string[]
  canvasPosition?: { x: number; y: number }
}

interface DbRow {
  id: string
  name: string
  task: string
  status: string
  agent_type: string
  worktree_path: string
  branch_name: string
  base_branch: string
  canvas_x: number
  canvas_y: number
  canvas_width: number
  canvas_height: number
  kanban_column: string
  terminal_id: string
  progress: number
  diff_summary: string
  created_at: string
  tags: string
  pending_approval: string | null
}

const STATUS_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  initializing: ['running', 'failed'],
  running: ['waiting', 'paused', 'completed', 'failed'],
  waiting: ['running', 'paused'],
  approved: ['running'],
  paused: ['running', 'failed'],
  review: ['completed', 'running'],
  completed: ['merged', 'archived', 'running'],
  failed: ['archived', 'running'],
  merged: ['archived'],
  archived: [],
}

const STATUS_TO_KANBAN: Partial<Record<SessionStatus, KanbanColumn>> = {
  initializing: 'backlog',
  running: 'in-progress',
  waiting: 'waiting-review',
  paused: 'in-progress',
  review: 'waiting-review',
  approved: 'approved',
  completed: 'done',
  failed: 'done',
  merged: 'done',
  archived: 'done',
}

export function validateTransition(from: SessionStatus, to: SessionStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

export class SessionManager {
  private readonly db: Database.Database
  private readonly worktreeManager: WorktreeManager
  private readonly terminalMux: TerminalMultiplexer
  private readonly broadcast: (msg: ServerMessage) => void

  constructor(opts: { repoPath: string; dbPath: string; broadcast: (msg: ServerMessage) => void }) {
    this.db = new Database(opts.dbPath)
    this.worktreeManager = new WorktreeManager(opts.repoPath)
    this.terminalMux = new TerminalMultiplexer()
    this.broadcast = opts.broadcast
    this.initDb()
    this.wireEvents()
  }

  async createSession(params: CreateSessionParams): Promise<AgentSession> {
    const id = nanoid(8)
    const baseBranch = params.baseBranch ?? 'main'
    const safeName = params.name
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase()
      .slice(0, 40)

    const session: AgentSession = {
      id,
      name: params.name.trim(),
      task: params.task.trim(),
      status: 'initializing',
      agentType: params.agentType ?? 'claude',
      worktreePath: `.agent-worktrees/${id}`,
      branchName: `agent/${safeName}-${id.slice(0, 8)}`,
      baseBranch,
      canvasPosition: params.canvasPosition ?? {
        x: 100 + Math.random() * 600,
        y: 100 + Math.random() * 400,
      },
      canvasSize: { width: 280, height: 220 },
      kanbanColumn: 'backlog',
      terminalId: nanoid(8),
      progress: 0,
      terminalOutput: [],
      diffSummary: '',
      createdAt: new Date(),
      tags: params.tags ?? [],
    }

    this.insertRow(session)
    this.broadcast({ event: 'session:created', payload: session })

    this.initSession(session).catch(err => {
      console.error(`[SessionManager] init failed for ${id}:`, err)
    })

    return session
  }

  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (!validateTransition(session.status, status)) {
      throw new Error(`Invalid transition: ${session.status} → ${status}`)
    }
    const kanbanColumn = STATUS_TO_KANBAN[status] ?? session.kanbanColumn
    this.db
      .prepare('UPDATE sessions SET status = ?, kanban_column = ? WHERE id = ?')
      .run(status, kanbanColumn, sessionId)
    this.broadcast({
      event: 'session:status',
      payload: { id: sessionId, status, progress: session.progress },
    })
  }

  getSession(sessionId: string): AgentSession | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as DbRow | undefined
    return row ? rowToSession(row) : null
  }

  listSessions(): AgentSession[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all() as DbRow[]
    return rows.map(rowToSession)
  }

  sendToTerminal(sessionId: string, data: string): void {
    this.terminalMux.sendToTerminal(sessionId, data)
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    this.terminalMux.resizeTerminal(sessionId, cols, rows)
  }

  updateCanvasPosition(sessionId: string, x: number, y: number): void {
    this.db.prepare('UPDATE sessions SET canvas_x = ?, canvas_y = ? WHERE id = ?').run(x, y, sessionId)
  }

  broadcastMessage(message: string, sessionIds?: string[]): string[] {
    const sessions = this.listSessions()
    const active = sessions.filter(s => ['running', 'waiting'].includes(s.status))
    const targets = sessionIds ? active.filter(s => sessionIds.includes(s.id)) : active
    for (const s of targets) {
      const data = `\r\n📢 Broadcast: ${message}\r\n`
      this.terminalMux.sendToTerminal(s.id, `${message}\n`)
      this.broadcast({ event: 'terminal:data', payload: { sessionId: s.id, data } })
    }
    return targets.map(s => s.id)
  }

  getTerminalBuffer(sessionId: string): string[] {
    return this.terminalMux.getBuffer(sessionId, 5000)
  }

  async getCurrentDiff(sessionId: string): Promise<GitDiff> {
    const session = this.getSession(sessionId)
    if (!session?.worktreePath) {
      return { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    }
    return this.worktreeManager.getDiff(sessionId, session.baseBranch)
  }

  handleApproval(sessionId: string, decision: 'approved' | 'rejected', comment?: string): void {
    const session = this.getSession(sessionId)
    if (!session || session.status !== 'waiting') return

    const msg =
      decision === 'approved'
        ? `> ✅ Approved${comment ? ': ' + comment : ''}, resuming...\r\n`
        : `> ❌ Rejected${comment ? ': ' + comment : ''}, paused\r\n`

    this.db.prepare('UPDATE sessions SET pending_approval = NULL WHERE id = ?').run(sessionId)
    this.pushTerminalDisplay(sessionId, msg)

    if (decision === 'approved') {
      this.updateStatus(sessionId, 'running')
      this.terminalMux.sendToTerminal(sessionId, 'y\n')
    } else {
      this.updateStatus(sessionId, 'paused')
      this.terminalMux.sendToTerminal(sessionId, 'n\n')
    }
  }

  archiveSession(sessionId: string): void {
    this.terminalMux.killTerminal(sessionId)
    try {
      this.updateStatus(sessionId, 'archived')
    } catch {
      // already in terminal state
    }
  }

  async getFileDiffContent(sessionId: string, filePath: string): Promise<{ original: string; modified: string }> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return this.worktreeManager.getFileDiffContent(
      this.worktreeManager.getWorktreePath(sessionId),
      session.baseBranch,
      filePath,
    )
  }

  async restoreSessions(): Promise<void> {
    const sessions = this.listSessions()

    for (const session of sessions) {
      if (session.status === 'initializing') {
        this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('failed', session.id)
        continue
      }

      const needsRestore = ['running', 'waiting', 'paused', 'review'].includes(session.status)
      if (!needsRestore || !session.worktreePath) continue

      const worktreePath = this.worktreeManager.getWorktreePath(session.id)
      try {
        await access(worktreePath)
      } catch {
        this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('failed', session.id)
        continue
      }

      if (!this.terminalMux.hasTerminal(session.id)) {
        this.terminalMux.createTerminal(session.id, worktreePath)
        this.pushTerminalDisplay(session.id, `\r\n\x1b[33m> [Server restarted — terminal restored]\x1b[0m\r\n`)
      }

      this.worktreeManager.watchDiff(session.id, session.baseBranch, diff => {
        this.db.prepare('UPDATE sessions SET diff_summary = ? WHERE id = ?').run(diff.stat, session.id)
        this.broadcast({ event: 'diff:update', payload: { sessionId: session.id, diff } })
      })
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    this.terminalMux.killTerminal(sessionId)
    await this.worktreeManager.removeWorktree(sessionId, session?.branchName).catch(() => {})
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  private async initSession(session: AgentSession): Promise<void> {
    const { id, name, baseBranch } = session
    try {
      this.pushTerminalDisplay(id, '> Creating git worktree...\r\n')

      const { branchName, worktreePath, resolvedBase } = await this.worktreeManager.createWorktree(
        id,
        name,
        baseBranch,
      )

      this.db
        .prepare('UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ? WHERE id = ?')
        .run(worktreePath, branchName, resolvedBase, id)

      this.pushTerminalDisplay(id, `> Branch: ${branchName}\r\n`)
      this.pushTerminalDisplay(id, `> Worktree: ${worktreePath}\r\n`)

      this.terminalMux.createTerminal(id, worktreePath)
      this.pushTerminalDisplay(id, `> Terminal ready (agent: ${session.agentType})\r\n`)

      this.worktreeManager.watchDiff(id, resolvedBase, diff => {
        this.db.prepare('UPDATE sessions SET diff_summary = ? WHERE id = ?').run(diff.stat, id)
        this.broadcast({ event: 'diff:update', payload: { sessionId: id, diff } })
      })

      this.updateStatus(id, 'running')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.pushTerminalDisplay(id, `> ❌ Init failed: ${msg}\r\n`)
      try {
        this.updateStatus(id, 'failed')
      } catch {
        // ignore if transition is invalid
      }
    }
  }

  private wireEvents(): void {
    this.terminalMux.on(
      'terminal:data',
      ({ sessionId, data }: { sessionId: string; data: string }) => {
        this.broadcast({ event: 'terminal:data', payload: { sessionId, data } })
      },
    )

    this.terminalMux.on(
      'approval:required',
      ({ sessionId, request }: { sessionId: string; request: ApprovalRequest }) => {
        const timestamp = new Date().toISOString()
        this.db
          .prepare('UPDATE sessions SET status = ?, pending_approval = ? WHERE id = ?')
          .run('waiting', JSON.stringify({ ...request, timestamp }), sessionId)
        const session = this.getSession(sessionId)
        if (session) {
          this.broadcast({
            event: 'session:status',
            payload: { id: sessionId, status: 'waiting', progress: session.progress },
          })
        }
        this.broadcast({
          event: 'approval:required',
          payload: { sessionId, request: { ...request, timestamp: new Date(timestamp) } },
        })
      },
    )

    this.terminalMux.on(
      'checkpoint:reached',
      ({ sessionId, description }: { sessionId: string; description: string }) => {
        const session = this.getSession(sessionId)
        if (!session) return
        const progress = Math.min(session.progress + 10, 95)
        this.db.prepare('UPDATE sessions SET progress = ? WHERE id = ?').run(progress, sessionId)
        this.broadcast({
          event: 'checkpoint:reached',
          payload: { sessionId, description, timestamp: new Date().toISOString() },
        })
        this.broadcast({
          event: 'session:status',
          payload: { id: sessionId, status: session.status, progress },
        })
      },
    )

    this.terminalMux.on(
      'terminal:exit',
      ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
        const session = this.getSession(sessionId)
        if (!session || !['running', 'paused'].includes(session.status)) return
        const status: SessionStatus = exitCode === 0 ? 'completed' : 'failed'
        try {
          this.updateStatus(sessionId, status)
        } catch {
          // ignore
        }
      },
    )
  }

  private pushTerminalDisplay(sessionId: string, data: string): void {
    this.broadcast({ event: 'terminal:data', payload: { sessionId, data } })
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        task          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'initializing',
        agent_type    TEXT NOT NULL DEFAULT 'claude',
        worktree_path TEXT NOT NULL DEFAULT '',
        branch_name   TEXT NOT NULL DEFAULT '',
        base_branch   TEXT NOT NULL DEFAULT 'main',
        canvas_x      REAL NOT NULL DEFAULT 100,
        canvas_y      REAL NOT NULL DEFAULT 100,
        canvas_width  REAL NOT NULL DEFAULT 280,
        canvas_height REAL NOT NULL DEFAULT 220,
        kanban_column TEXT NOT NULL DEFAULT 'backlog',
        terminal_id   TEXT NOT NULL,
        progress      INTEGER NOT NULL DEFAULT 0,
        diff_summary  TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        tags          TEXT NOT NULL DEFAULT '[]',
        pending_approval TEXT
      )
    `)
  }

  private insertRow(s: AgentSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, name, task, status, agent_type, worktree_path, branch_name, base_branch,
          canvas_x, canvas_y, canvas_width, canvas_height,
          kanban_column, terminal_id, progress, diff_summary, created_at, tags, pending_approval
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        s.id,
        s.name,
        s.task,
        s.status,
        s.agentType,
        s.worktreePath,
        s.branchName,
        s.baseBranch,
        s.canvasPosition.x,
        s.canvasPosition.y,
        s.canvasSize.width,
        s.canvasSize.height,
        s.kanbanColumn,
        s.terminalId,
        s.progress,
        s.diffSummary,
        s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
        JSON.stringify(s.tags),
        s.pendingApproval ? JSON.stringify(s.pendingApproval) : null,
      )
  }
}

function rowToSession(r: DbRow): AgentSession {
  return {
    id: r.id,
    name: r.name,
    task: r.task,
    status: r.status as SessionStatus,
    agentType: r.agent_type as AgentType,
    worktreePath: r.worktree_path,
    branchName: r.branch_name,
    baseBranch: r.base_branch,
    canvasPosition: { x: r.canvas_x, y: r.canvas_y },
    canvasSize: { width: r.canvas_width, height: r.canvas_height },
    kanbanColumn: r.kanban_column as KanbanColumn,
    terminalId: r.terminal_id,
    progress: r.progress,
    diffSummary: r.diff_summary,
    terminalOutput: [],
    createdAt: new Date(r.created_at),
    tags: JSON.parse(r.tags) as string[],
    pendingApproval: r.pending_approval
      ? (JSON.parse(r.pending_approval) as ApprovalRequest)
      : undefined,
  }
}

export async function createSessionManager(opts: {
  repoPath: string
  dbPath: string
  broadcast: (msg: ServerMessage) => void
}): Promise<SessionManager> {
  await mkdir(dirname(opts.dbPath), { recursive: true })
  const manager = new SessionManager(opts)
  await manager.restoreSessions()
  return manager
}
