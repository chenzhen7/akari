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
  windowState?: WindowState
  lastActiveWorkspaceId?: string
}

const STATE_VERSION = 1
const STATE_FILE_NAME = 'window-state.json'
const SAVE_DEBOUNCE_MS = 500
const MIN_VISIBLE_OVERLAP = 100

const DEFAULT_WIDTH = 1400
const DEFAULT_HEIGHT = 900

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

  getWindowState(): WindowState | undefined {
    return this.state.windowState ? this.validateBounds(this.state.windowState) : undefined
  }

  setWindowState(windowState: WindowState): void {
    this.state.windowState = windowState
    this.scheduleSave()
  }

  getLastActiveWorkspaceId(): string | undefined {
    return this.state.lastActiveWorkspaceId
  }

  setLastActiveWorkspaceId(workspaceId: string | undefined): void {
    this.state.lastActiveWorkspaceId = workspaceId
    this.scheduleSave()
  }

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
    return { version: STATE_VERSION }
  }

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
  if (s.version !== STATE_VERSION) {
    return false
  }
  if (s.windowState !== undefined && !isWindowState(s.windowState)) {
    return false
  }
  if (s.lastActiveWorkspaceId !== undefined && typeof s.lastActiveWorkspaceId !== 'string') {
    return false
  }
  return true
}

function isWindowState(obj: unknown): obj is WindowState {
  if (typeof obj !== 'object' || obj === null) {
    return false
  }
  const s = obj as Record<string, unknown>
  return (
    typeof s.x === 'number' &&
    typeof s.y === 'number' &&
    typeof s.width === 'number' &&
    typeof s.height === 'number' &&
    typeof s.maximized === 'boolean' &&
    typeof s.fullscreen === 'boolean'
  )
}
