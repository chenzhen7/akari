import { homedir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { SettingsRepository } from './db/repositories/settings.repository.js'

const DEFAULT_WORKTREE_BASE_DIR = join(homedir(), '.akari', 'worktrees')

export class SettingsStore {
  private readonly repository: SettingsRepository

  constructor(db: Database.Database) {
    this.repository = new SettingsRepository(db)
  }

  get(key: string): string | null {
    return this.repository.get(key)
  }

  set(key: string, value: string): void {
    this.repository.set(key, value)
  }

  getAll(): Record<string, string> {
    return this.repository.getAll()
  }

  getWorktreeBaseDir(): string {
    return this.get('worktree.baseDir') ?? DEFAULT_WORKTREE_BASE_DIR
  }

  setWorktreeBaseDir(value: string): void {
    this.set('worktree.baseDir', value)
  }
}
