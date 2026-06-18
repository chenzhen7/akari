import Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { access } from 'node:fs/promises'
import { resolve, parse } from 'node:path'
import type { Workspace } from '@akari/shared-types'
import { getGitRoot } from './git-utils.js'

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
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
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      )
    `)
  }

  async migrate(): Promise<void> {
    const rows = this.db
      .prepare("SELECT id, path FROM workspaces WHERE repo_root IS NULL OR repo_root = ''")
      .all() as Array<{ id: string; path: string }>
    for (const row of rows) {
      const repoRoot = (await getGitRoot(row.path)) ?? row.path
      this.db.prepare('UPDATE workspaces SET repo_root = ? WHERE id = ?').run(repoRoot, row.id)
    }
  }

  async ensureDefaultWorkspace(defaultPath: string): Promise<void> {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM workspaces').get() as { count: number }
    if (count.count === 0) {
      const id = nanoid(8)
      const now = new Date().toISOString()
      const name = parse(defaultPath).base || 'akari'
      const resolvedPath = normalizePath(resolve(defaultPath))
      const repoRoot = (await getGitRoot(resolvedPath)) ?? resolvedPath
      this.db.prepare(
        'INSERT INTO workspaces (id, name, path, repo_root, is_current, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, name, resolvedPath, repoRoot, 1, now, now)
    }
  }

  listWorkspaces(): Workspace[] {
    const rows = this.db.prepare('SELECT * FROM workspaces ORDER BY last_opened_at DESC').all() as Array<{
      id: string
      name: string
      path: string
      repo_root: string
      is_current: number
      created_at: string
      last_opened_at: string
    }>
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      path: r.path,
      repoRoot: r.repo_root,
      isCurrent: r.is_current === 1,
      createdAt: new Date(r.created_at),
      lastOpenedAt: new Date(r.last_opened_at),
    }))
  }

  getCurrentWorkspace(): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE is_current = 1').get() as
      | {
          id: string
          name: string
          path: string
          repo_root: string
          is_current: number
          created_at: string
          last_opened_at: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      repoRoot: row.repo_root,
      isCurrent: row.is_current === 1,
      createdAt: new Date(row.created_at),
      lastOpenedAt: new Date(row.last_opened_at),
    }
  }

  getWorkspaceById(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | {
          id: string
          name: string
          path: string
          repo_root: string
          is_current: number
          created_at: string
          last_opened_at: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      repoRoot: row.repo_root,
      isCurrent: row.is_current === 1,
      createdAt: new Date(row.created_at),
      lastOpenedAt: new Date(row.last_opened_at),
    }
  }

  async addWorkspace(name: string, path: string): Promise<Workspace> {
    const id = nanoid(8)
    const now = new Date().toISOString()
    const resolvedPath = normalizePath(resolve(path))
    const repoRoot = (await getGitRoot(resolvedPath)) ?? resolvedPath
    this.db.prepare(
      'INSERT INTO workspaces (id, name, path, repo_root, is_current, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, name, resolvedPath, repoRoot, 0, now, now)
    return {
      id,
      name,
      path: resolvedPath,
      repoRoot,
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
    const repoRoot = await getGitRoot(path)
    if (!repoRoot) {
      return { valid: false, error: '所选路径不在 Git 仓库内' }
    }
    return { valid: true }
  }
}
