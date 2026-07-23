import type Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { access } from 'node:fs/promises'
import { resolve, parse } from 'node:path'
import type { Workspace } from '@akari/shared-types'
import { getGitRoot } from '../../git/git-utils.js'

interface WorkspaceRow {
  id: string
  name: string
  path: string
  repo_root: string
  is_git: number
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
    createdAt: new Date(r.created_at),
    lastOpenedAt: new Date(r.last_opened_at),
  }
}

export class WorkspaceRepository {
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
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      )
    `)
  }

  async migrate(): Promise<void> {
    const cols: string[] = this.db
      .prepare('PRAGMA table_info(workspaces)')
      .all()
      .map((row: any) => row.name as string)

    // Drop the deprecated is_current column if it still exists.
    if (cols.includes('is_current')) {
      this.db.exec('ALTER TABLE workspaces DROP COLUMN is_current')
    }

    const addedIsGit = !cols.includes('is_git')
    if (addedIsGit) {
      this.db.exec('ALTER TABLE workspaces ADD COLUMN is_git INTEGER NOT NULL DEFAULT 0')
    }

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
      this.insertWorkspace(id, name, resolvedPath, repoRoot, isGit, now)
    }
  }

  list(): Workspace[] {
    const rows = this.db.prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC').all() as WorkspaceRow[]
    return rows.map(rowToWorkspace)
  }

  getById(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
    return row ? rowToWorkspace(row) : null
  }

  getByPath(path: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE path = ?').get(path) as WorkspaceRow | undefined
    return row ? rowToWorkspace(row) : null
  }

  async create(name: string, path: string): Promise<Workspace> {
    const id = nanoid(8)
    const now = new Date().toISOString()
    const resolvedPath = normalizePath(resolve(path))
    const gitRoot = await getGitRoot(resolvedPath)
    const repoRoot = gitRoot ?? resolvedPath
    const isGit = gitRoot !== null
    this.insertWorkspace(id, name, resolvedPath, repoRoot, isGit, now)
    return {
      id,
      name,
      path: resolvedPath,
      repoRoot,
      isGit,
      createdAt: new Date(now),
      lastOpenedAt: new Date(now),
    }
  }

  touchLastOpened(id: string): boolean {
    const target = this.getById(id)
    if (!target) return false

    const now = new Date().toISOString()
    this.db.prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(now, id)
    return true
  }

  private insertWorkspace(
    id: string,
    name: string,
    path: string,
    repoRoot: string,
    isGit: boolean,
    now: string,
  ): void {
    this.db.prepare(
      'INSERT INTO workspaces (id, name, path, repo_root, is_git, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, name, path, repoRoot, isGit ? 1 : 0, now, now)
  }

  delete(id: string): boolean {
    const info = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    return info.changes > 0
  }
}

export async function validatePath(path: string): Promise<{ valid: boolean; error?: string }> {
  try {
    await access(path)
  } catch {
    return { valid: false, error: '路径不存在或无法访问' }
  }
  return { valid: true }
}
