import type Database from 'better-sqlite3'
import type { Workspace } from '@akari/shared-types'
import { WorkspaceRepository, validatePath } from './db/repositories/workspace.repository.js'

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

  getCurrentWorkspace(): Workspace | null {
    return this.repository.getCurrent()
  }

  getWorkspaceById(id: string): Workspace | null {
    return this.repository.getById(id)
  }

  async addWorkspace(name: string, path: string): Promise<Workspace> {
    return this.repository.create(name, path)
  }

  switchWorkspace(id: string): Workspace | null {
    const target = this.repository.getById(id)
    if (!target) return null
    const switched = this.repository.switch(id)
    if (!switched) return null
    return { ...target, isCurrent: true, lastOpenedAt: new Date() }
  }

  deleteWorkspace(id: string): boolean {
    return this.repository.delete(id)
  }

  async validatePath(path: string): Promise<{ valid: boolean; error?: string }> {
    return validatePath(path)
  }
}
