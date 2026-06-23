import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { access } from 'node:fs/promises'
import { resolve, parse } from 'node:path'
import type { Workspace } from '@akari/shared-types'
import { getGitRoot } from './git-utils.js'

interface WorkspaceRow {
  id: string
  name: string
  path: string
  repo_root: string
  is_git: number
  is_current: number
  created_at: string
  last_opened_at: string
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function rowToWorkspace(r: WorkspaceRow): Workspace {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    repoRoot: r.repo_root,
    isGit: r.is_git === 1,
    isCurrent: r.is_current === 1,
    createdAt: new Date(r.created_at),
    lastOpenedAt: new Date(r.last_opened_at),
  }
}

export class WorkspaceManager {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    this.initDb()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        repo_root TEXT,
        is_git INTEGER NOT NULL DEFAULT 0,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      )
    `)
  }

  async migrate(): Promise<void> {
    const cols: string[] = this.db
      .prepare("PRAGMA table_info(workspaces)")
      .all()
      .map((row: any) => row.name as string)

    const addedIsGit = !cols.includes('is_git')
    if (addedIsGit) {
      this.db.exec('ALTER TABLE workspaces ADD COLUMN is_git INTEGER NOT NULL DEFAULT 0')
    }

    // Re-detect git status for all rows when the column is freshly added,
    // or for rows that haven't had their repo_root resolved yet.
    const rows = this.db
      .prepare(
        addedIsGit
          ? 'SELECT id, path FROM workspaces'
          : "SELECT id, path FROM workspaces WHERE repo_root IS NULL OR repo_root = ''",
      )
      .all() as Array<{ id: string; path: string }>
    for (const row of rows) {
      const gitRoot = await getGitRoot(row.path)
      const repoRoot = gitRoot ?? row.path
      const isGit = gitRoot !== null
      this.db.prepare('UPDATE workspaces SET repo_root = ?, is_git = ? WHERE id = ?').run(repoRoot, isGit ? 1 : 0, row.id)
    }
  }

  async ensureDefaultWorkspace(defaultPath: string): Promise<void> {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM workspaces').get() as { count: number }
    if (count.count === 0) {
      const id = nanoid(8)
      const now = new Date().toISOString()
      const name = parse(defaultPath).base || 'akari'
      const resolvedPath = normalizePath(resolve(defaultPath))
      const gitRoot = await getGitRoot(resolvedPath)
      const repoRoot = gitRoot ?? resolvedPath
      const isGit = gitRoot !== null
      this.db.prepare(
        'INSERT INTO workspaces (id, name, path, repo_root, is_git, is_current, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, name, resolvedPath, repoRoot, isGit ? 1 : 0, 1, now, now)
    }
  }

  listWorkspaces(): Workspace[] {
    const rows = this.db.prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC').all() as WorkspaceRow[]
    return rows.map(rowToWorkspace)
  }

  getCurrentWorkspace(): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE is_current = 1').get() as WorkspaceRow | undefined
    return row ? rowToWorkspace(row) : null
  }

  getWorkspaceById(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
    return row ? rowToWorkspace(row) : null
  }

  async addWorkspace(name: string, path: string): Promise<Workspace> {
    const id = nanoid(8)
    const now = new Date().toISOString()
    const resolvedPath = normalizePath(resolve(path))
    const gitRoot = await getGitRoot(resolvedPath)
    const repoRoot = gitRoot ?? resolvedPath
    const isGit = gitRoot !== null
    this.db.prepare(
      'INSERT INTO workspaces (id, name, path, repo_root, is_git, is_current, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, name, resolvedPath, repoRoot, isGit ? 1 : 0, 0, now, now)
    return {
      id,
      name,
      path: resolvedPath,
      repoRoot,
      isGit,
      isCurrent: false,
      createdAt: new Date(now),
      lastOpenedAt: new Date(now),
    }
  }

  switchWorkspace(id: string): Workspace | null {
    const target = this.getWorkspaceById(id)
    if (!target) return null

    const now = new Date().toISOString()
    this.db.prepare('UPDATE workspaces SET is_current = 0').run()
    this.db.prepare('UPDATE workspaces SET is_current = 1, last_opened_at = ? WHERE id = ?').run(now, id)

    return { ...target, isCurrent: true, lastOpenedAt: new Date(now) }
  }

  deleteWorkspace(id: string): boolean {
    const info = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    return info.changes > 0
  }

  async validatePath(path: string): Promise<{ valid: boolean; error?: string }> {
    try {
      await access(path)
    } catch {
      return { valid: false, error: '路径不存在或无法访问' }
    }
    return { valid: true }
  }
}
