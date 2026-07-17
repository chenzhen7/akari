import { app, screen } from 'electron'
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
const SAVE_DEBOUNCE_MS = 500
const MIN_VISIBLE_OVERLAP = 100

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE_NAME)
}

export class WindowStateStore {
  private readonly statePath: string
  private state: StoredState
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pendingSave = false

  constructor() {
    this.statePath = getStatePath()
    this.state = this.load()
  }

  getAll(): Record<string, WindowState> {
    return { ...this.state.windowStates }
  }

  get(workspaceId: string): WindowState | undefined {
    const raw = this.state.windowStates[workspaceId]
    return raw ? this.validateBounds(raw) : undefined
  }

  set(workspaceId: string, state: WindowState): void {
    this.state.windowStates[workspaceId] = state
    this.scheduleSave()
  }

  delete(workspaceId: string): void {
    delete this.state.windowStates[workspaceId]
    this.scheduleSave()
  }

  getLastActiveWorkspaceId(): string | undefined {
    return this.state.lastActiveWorkspaceId
  }

  setLastActiveWorkspaceId(workspaceId: string | undefined): void {
    this.state.lastActiveWorkspaceId = workspaceId
    this.scheduleSave()
  }

  /** Flush any pending write synchronously. Call before app quit. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.pendingSave) {
      this.save()
    }
  }

  private scheduleSave(): void {
    this.pendingSave = true
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, SAVE_DEBOUNCE_MS)
  }

  private save(): void {
    this.pendingSave = false
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch (err) {
      console.error('[window-state-store] failed to save:', err)
    }
  }

  private load(): StoredState {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (isStoredState(parsed)) {
        return parsed
      }
    } catch {
      // ignore missing or invalid state
    }
    return { version: STATE_VERSION, windowStates: {} }
  }

  /**
   * Ensure the window would be visible on at least one current display.
   * If it would be entirely off-screen, center it on the primary display
   * with a clamped size.
   */
  private validateBounds(state: WindowState): WindowState {
    const displays = screen.getAllDisplays()
    if (displays.length === 0) {
      return state
    }

    const right = state.x + state.width
    const bottom = state.y + state.height

    const isOnScreen = displays.some((display) => {
      const dx = display.bounds.x
      const dy = display.bounds.y
      const dw = display.bounds.width
      const dh = display.bounds.height
      const overlapW = Math.min(right, dx + dw) - Math.max(state.x, dx)
      const overlapH = Math.min(bottom, dy + dh) - Math.max(state.y, dy)
      return overlapW >= MIN_VISIBLE_OVERLAP && overlapH >= MIN_VISIBLE_OVERLAP
    })

    if (isOnScreen) {
      return state
    }

    const primary = screen.getPrimaryDisplay()
    const { width: maxWidth, height: maxHeight } = primary.workAreaSize
    const width = Math.min(state.width, maxWidth)
    const height = Math.min(state.height, maxHeight)
    const x = primary.bounds.x + Math.round((primary.workAreaSize.width - width) / 2)
    const y = primary.bounds.y + Math.round((primary.workAreaSize.height - height) / 2)

    return { ...state, x, y, width, height }
  }
}

function isStoredState(obj: unknown): obj is StoredState {
  if (typeof obj !== 'object' || obj === null) {
    return false
  }
  const s = obj as Record<string, unknown>
  return (
    s.version === STATE_VERSION &&
    typeof s.windowStates === 'object' &&
    s.windowStates !== null &&
    !Array.isArray(s.windowStates)
  )
}
