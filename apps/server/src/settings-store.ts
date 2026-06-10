import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_WORKTREE_BASE_DIR = join(homedir(), '.akari', 'worktrees')

export class SettingsStore {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
    this.initDb()
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  }

  getWorktreeBaseDir(): string {
    return this.get('worktree.baseDir') ?? DEFAULT_WORKTREE_BASE_DIR
  }

  setWorktreeBaseDir(value: string): void {
    this.set('worktree.baseDir', value)
  }
}
