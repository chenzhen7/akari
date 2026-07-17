import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
  fullscreen: boolean
}

interface StoredState {
  version: number
  windowStates: Record<string, WindowState>
  lastActiveWorkspaceId?: string
}

const STATE_VERSION = 1
const STATE_FILE_NAME = 'window-state.json'

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE_NAME)
}

export class WindowStateStore {
  private readonly statePath: string
  private state: StoredState

  constructor() {
    this.statePath = getStatePath()
    this.state = this.load()
  }

  private load(): StoredState {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf-8')
      const parsed = JSON.parse(raw) as StoredState
      if (parsed.version === STATE_VERSION) {
        return parsed
      }
    } catch {
      // ignore missing or invalid state
    }
    return { version: STATE_VERSION, windowStates: {} }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch (err) {
      console.error('[window-state-store] failed to save:', err)
    }
  }

  getAll(): Record<string, WindowState> {
    return { ...this.state.windowStates }
  }

  get(workspaceId: string): WindowState | undefined {
    return this.state.windowStates[workspaceId]
  }

  set(workspaceId: string, state: WindowState): void {
    this.state.windowStates[workspaceId] = state
    this.save()
  }

  delete(workspaceId: string): void {
    delete this.state.windowStates[workspaceId]
    this.save()
  }

  getLastActiveWorkspaceId(): string | undefined {
    return this.state.lastActiveWorkspaceId
  }

  setLastActiveWorkspaceId(workspaceId: string | undefined): void {
    this.state.lastActiveWorkspaceId = workspaceId
    this.save()
  }
}
