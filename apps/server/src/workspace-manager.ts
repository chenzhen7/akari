import path from 'node:path'
import type Database from 'better-sqlite3'
import type { Workspace } from '@akari/shared-types'
import { WorkspaceRepository, validatePath } from './db/repositories/workspace.repository.js'

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

export class WorkspaceManager {
  private readonly repository: WorkspaceRepository

  constructor(db: Database.Database) {
    this.repository = new WorkspaceRepository(db)
  }

  async migrate(): Promise<void> {
    return this.repository.migrate()
  }

  async ensureDefaultWorkspace(defaultPath: string): Promise<void> {
    return this.repository.ensureDefaultWorkspace(defaultPath)
  }

  listWorkspaces(): Workspace[] {
    return this.repository.list()
  }

  getWorkspaceById(id: string): Workspace | null {
    return this.repository.getById(id)
  }

  async addWorkspace(name: string, path: string): Promise<Workspace | null> {
    const normalizedPath = normalizePath(path)
    const existing = this.repository.getByPath(normalizedPath)
    if (existing) return existing
    return this.repository.create(name, normalizedPath)
  }

  activateWorkspace(id: string): Workspace | null {
    const target = this.repository.getById(id)
    if (!target) return null
    const touched = this.repository.touchLastOpened(id)
    if (!touched) return null
    return { ...target, lastOpenedAt: new Date() }
  }

  deleteWorkspace(id: string): boolean {
    return this.repository.delete(id)
  }

  async validatePath(path: string): Promise<{ valid: boolean; error?: string }> {
    return validatePath(path)
  }
}
