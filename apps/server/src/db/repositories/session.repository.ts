import type Database from 'better-sqlite3'
import type {
  AgentSession,
  AgentType,
  CanvasEdge,
  CollaborationRole,
  KanbanColumn,
  SessionStatus,
  SessionTab,
  Workspace,
} from '@akari/shared-types'

interface SessionDbRow {
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
  collaboration_role: string | null
  parent_session_id: string | null
  child_session_ids: string | null
  last_ai_message: string
  tabs: string
  active_tab_id: string | null
  workspace_id: string
  is_main: number
}

function parseDiffSummary(raw: string): { additions: number; deletions: number } {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.additions === 'number' && typeof parsed.deletions === 'number') {
      return parsed
    }
  } catch {
    // fallback: try to parse old string format like "5 insertions(+), 3 deletions(-)"
  }
  const additions = parseInt(raw.match(/(\d+) insertion/)?.[1] ?? '0') || 0
  const deletions = parseInt(raw.match(/(\d+) deletion/)?.[1] ?? '0') || 0
  return { additions, deletions }
}

function rowToSession(r: SessionDbRow): AgentSession {
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
    diffSummary: parseDiffSummary(r.diff_summary),
    lastAiMessage: r.last_ai_message,
    terminalOutput: [],
    createdAt: new Date(r.created_at),
    tags: JSON.parse(r.tags) as string[],
    collaborationRole: (r.collaboration_role ?? 'standalone') as CollaborationRole,
    parentSessionId: r.parent_session_id ?? undefined,
    childSessionIds: JSON.parse(r.child_session_ids ?? '[]') as string[],
    tabs: JSON.parse(r.tabs ?? '[]') as SessionTab[],
    activeTabId: r.active_tab_id ?? null,
    workspaceId: r.workspace_id ?? '',
    isMain: r.is_main === 1,
  }
}

export class SessionRepository {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    this.initDb()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        task                TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'initializing',
        agent_type          TEXT NOT NULL DEFAULT 'claude',
        worktree_path       TEXT NOT NULL DEFAULT '',
        branch_name         TEXT NOT NULL DEFAULT '',
        base_branch         TEXT NOT NULL DEFAULT 'main',
        canvas_x            REAL NOT NULL DEFAULT 100,
        canvas_y            REAL NOT NULL DEFAULT 100,
        canvas_width        REAL NOT NULL DEFAULT 280,
        canvas_height       REAL NOT NULL DEFAULT 280,
        kanban_column       TEXT NOT NULL DEFAULT 'backlog',
        terminal_id         TEXT NOT NULL,
        progress            INTEGER NOT NULL DEFAULT 0,
        diff_summary        TEXT NOT NULL DEFAULT '{"additions":0,"deletions":0}',
        created_at          TEXT NOT NULL,
        tags                TEXT NOT NULL DEFAULT '[]',
        pending_approval    TEXT,
        collaboration_role  TEXT NOT NULL DEFAULT 'standalone',
        parent_session_id   TEXT,
        child_session_ids   TEXT NOT NULL DEFAULT '[]',
        last_ai_message    TEXT NOT NULL DEFAULT '',
        tabs               TEXT NOT NULL DEFAULT '[]',
        active_tab_id      TEXT,
        workspace_id       TEXT NOT NULL DEFAULT '',
        is_main            INTEGER NOT NULL DEFAULT 0
      )
    `)

    // Migration: add columns if they don't exist
    const cols: string[] = this.db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .map((row: any) => row.name as string)
    if (!cols.includes('last_ai_message')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_ai_message TEXT NOT NULL DEFAULT ""')
    }
    if (!cols.includes('tabs')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN tabs TEXT NOT NULL DEFAULT "[]"')
    }
    if (!cols.includes('active_tab_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN active_tab_id TEXT')
    }
    if (!cols.includes('workspace_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ""')
    }
    if (!cols.includes('is_main')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0')
    }

    // Migration: 把旧数据中 type 为 'claude' 的标签页统一改为通用 'agent'
    const rows = this.db.prepare('SELECT id, tabs FROM sessions').all() as { id: string; tabs: string }[]
    for (const row of rows) {
      let tabs: SessionTab[]
      try {
        tabs = JSON.parse(row.tabs)
      } catch {
        continue
      }
      let changed = false
      for (const tab of tabs) {
        if ((tab.type as string) === 'claude') {
          tab.type = 'agent'
          changed = true
        }
      }
      if (changed) {
        this.db.prepare('UPDATE sessions SET tabs = ? WHERE id = ?').run(JSON.stringify(tabs), row.id)
      }
    }
  }

  getById(id: string): AgentSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionDbRow | undefined
    return row ? rowToSession(row) : null
  }

  getMainByWorkspaceId(workspaceId: string): AgentSession | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? AND is_main = 1')
      .get(workspaceId) as SessionDbRow | undefined
    return row ? rowToSession(row) : null
  }

  listByWorkspaceId(workspaceId: string): AgentSession[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as SessionDbRow[]
    return rows.map(rowToSession)
  }

  create(s: AgentSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, name, task, status, agent_type, worktree_path, branch_name, base_branch,
          canvas_x, canvas_y, canvas_width, canvas_height,
          kanban_column, terminal_id, progress, diff_summary, last_ai_message, created_at, tags,
          collaboration_role, parent_session_id, child_session_ids, tabs, active_tab_id, workspace_id, is_main
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        JSON.stringify(s.diffSummary),
        s.lastAiMessage,
        s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
        JSON.stringify(s.tags),
        s.collaborationRole,
        s.parentSessionId ?? null,
        JSON.stringify(s.childSessionIds),
        JSON.stringify(s.tabs),
        s.activeTabId,
        s.workspaceId,
        s.isMain ? 1 : 0,
      )
  }

  updateStatus(id: string, status: SessionStatus, kanbanColumn: KanbanColumn): void {
    this.db.prepare('UPDATE sessions SET status = ?, kanban_column = ? WHERE id = ?').run(status, kanbanColumn, id)
  }

  updateCanvasPosition(id: string, x: number, y: number): void {
    this.db.prepare('UPDATE sessions SET canvas_x = ?, canvas_y = ? WHERE id = ?').run(x, y, id)
  }

  updateWorktreeAndBranch(id: string, worktreePath: string, branchName: string, baseBranch: string): void {
    this.db
      .prepare('UPDATE sessions SET worktree_path = ?, branch_name = ?, base_branch = ? WHERE id = ?')
      .run(worktreePath, branchName, baseBranch, id)
  }

  updateBranch(id: string, branchName: string, baseBranch?: string): void {
    if (baseBranch !== undefined) {
      this.db.prepare('UPDATE sessions SET branch_name = ?, base_branch = ? WHERE id = ?').run(branchName, baseBranch, id)
    } else {
      this.db.prepare('UPDATE sessions SET branch_name = ? WHERE id = ?').run(branchName, id)
    }
  }

  updateBranchAndBase(id: string, branchName: string, baseBranch: string): void {
    this.db.prepare('UPDATE sessions SET branch_name = ?, base_branch = ? WHERE id = ?').run(branchName, baseBranch, id)
  }

  updateMainSessionClear(id: string, workspaceName: string): void {
    this.db
      .prepare('UPDATE sessions SET branch_name = ?, base_branch = ?, diff_summary = ?, name = ? WHERE id = ?')
      .run('', '', '{"additions":0,"deletions":0,"files":0}', workspaceName, id)
  }

  updateTabs(id: string, tabs: SessionTab[], activeTabId?: string | null): void {
    if (activeTabId !== undefined) {
      this.db
        .prepare('UPDATE sessions SET tabs = ?, active_tab_id = ? WHERE id = ?')
        .run(JSON.stringify(tabs), activeTabId, id)
    } else {
      this.db.prepare('UPDATE sessions SET tabs = ? WHERE id = ?').run(JSON.stringify(tabs), id)
    }
  }

  updateActiveTab(id: string, activeTabId: string | null): void {
    this.db.prepare('UPDATE sessions SET active_tab_id = ? WHERE id = ?').run(activeTabId, id)
  }

  updateLastAiMessage(id: string, message: string): void {
    this.db.prepare('UPDATE sessions SET last_ai_message = ? WHERE id = ?').run(message, id)
  }

  updateDiffSummary(id: string, summary: { additions: number; deletions: number; files?: number }): void {
    this.db.prepare('UPDATE sessions SET diff_summary = ? WHERE id = ?').run(JSON.stringify(summary), id)
  }

  updateTerminalIdAndTabs(id: string, tabs: SessionTab[], activeTabId: string | null, terminalId: string): void {
    this.db
      .prepare('UPDATE sessions SET tabs = ?, active_tab_id = ?, terminal_id = ? WHERE id = ?')
      .run(JSON.stringify(tabs), activeTabId, terminalId ?? '', id)
  }

  updateTabsAndTerminalId(id: string, tabs: SessionTab[], terminalId: string): void {
    this.db
      .prepare('UPDATE sessions SET tabs = ?, terminal_id = ? WHERE id = ?')
      .run(JSON.stringify(tabs), terminalId, id)
  }

  updateStatusOnly(id: string, status: SessionStatus): void {
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }
}
