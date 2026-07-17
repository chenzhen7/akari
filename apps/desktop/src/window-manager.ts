import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { WindowStateStore, type WindowState } from './window-state-store.js'

export interface WindowManagerOptions {
  loadUrl: string
  preloadPath: string
  stateStore: WindowStateStore
  isDev: boolean
}

export interface AkariWindow {
  window: BrowserWindow
  workspaceId: string
}

interface WorkspaceSummary {
  id: string
  name: string
  path: string
  repoRoot: string
  isGit: boolean
  isCurrent: boolean
  createdAt?: string
  lastOpenedAt?: string
}

const DEFAULT_WIDTH = 1400
const DEFAULT_HEIGHT = 900
const MIN_WIDTH = 900
const MIN_HEIGHT = 600

export class WindowManager {
  private readonly windows = new Map<number, AkariWindow>()
  private readonly workspaceToWindow = new Map<string, number>()
  private readonly stateStore: WindowStateStore
  private readonly loadUrl: string
  private readonly preloadPath: string
  private readonly isDev: boolean

  constructor(options: WindowManagerOptions) {
    this.loadUrl = options.loadUrl
    this.preloadPath = options.preloadPath
    this.stateStore = options.stateStore
    this.isDev = options.isDev
  }

  registerIpcHandlers(): void {
    ipcMain.handle('workspace:open-window', (_event: IpcMainInvokeEvent, workspaceId: string) => {
      void this.openWorkspaceWindow(workspaceId)
    })

    ipcMain.handle('workspace:get-window-id', (event: IpcMainInvokeEvent) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win?.id ?? null
    })

    ipcMain.handle('workspace:get-workspace-id', (event: IpcMainInvokeEvent) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return null
      return this.windows.get(win.id)?.workspaceId ?? null
    })
  }

  async restoreWindows(workspaces: WorkspaceSummary[]): Promise<void> {
    const states = this.stateStore.getAll()
    const stateWorkspaceIds = Object.keys(states)
    const validWorkspaceIds = new Set(workspaces.map(w => w.id))

    // Open windows for any workspace that has persisted state and still exists
    const workspacesToRestore = workspaces.filter(w => stateWorkspaceIds.includes(w.id))

    if (workspacesToRestore.length === 0) {
      // No persisted state: open the current workspace
      const currentWorkspace = workspaces.find(w => w.isCurrent) ?? workspaces[0]
      if (currentWorkspace) {
        await this.openWorkspaceWindow(currentWorkspace.id)
      }
      return
    }

    for (const workspace of workspacesToRestore) {
      await this.openWorkspaceWindow(workspace.id)
    }

    const lastActiveId = this.stateStore.getLastActiveWorkspaceId()
    if (lastActiveId) {
      const windowId = this.workspaceToWindow.get(lastActiveId)
      if (windowId) {
        this.windows.get(windowId)?.window.focus()
      }
    }
  }

  async openWorkspaceWindow(workspaceId: string): Promise<BrowserWindow> {
    const existingWindowId = this.workspaceToWindow.get(workspaceId)
    const existing = existingWindowId ? this.windows.get(existingWindowId)?.window : undefined
    if (existing) {
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.focus()
      return existing
    }

    const state = this.stateStore.get(workspaceId)
    const window = this.createBrowserWindow(workspaceId, state)
    const url = this.buildLoadUrl(workspaceId)
    await window.loadURL(url)

    const akariWindow: AkariWindow = { window, workspaceId }
    this.windows.set(window.id, akariWindow)
    this.workspaceToWindow.set(workspaceId, window.id)

    this.attachWindowListeners(window, workspaceId)

    return window
  }

  private createBrowserWindow(workspaceId: string, state?: WindowState): BrowserWindow {
    const options: Electron.BrowserWindowConstructorOptions = {
      width: state?.width ?? DEFAULT_WIDTH,
      height: state?.height ?? DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      x: state?.x,
      y: state?.y,
      frame: false,
      icon: resolveIconPath(),
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--workspace-id=${workspaceId}`],
      },
    }

    const window = new BrowserWindow(options)

    if (state?.maximized) {
      window.maximize()
    } else if (state?.fullscreen) {
      window.setFullScreen(true)
    }

    window.on('maximize', () => {
      window.webContents.send('window-maximized-change', true)
    })

    window.on('unmaximize', () => {
      window.webContents.send('window-maximized-change', false)
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      void import('electron').then(({ shell }) => shell.openExternal(url))
      return { action: 'deny' }
    })

    window.webContents.on('did-finish-load', () => {
      if (!window.isVisible()) {
        window.show()
      }
    })

    return window
  }

  private buildLoadUrl(workspaceId: string): string {
    const base = this.loadUrl
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}workspaceId=${encodeURIComponent(workspaceId)}`
  }

  private attachWindowListeners(window: BrowserWindow, workspaceId: string): void {
    window.once('ready-to-show', () => {
      window.show()
      if (this.isDev) {
        window.webContents.openDevTools()
      }
    })

    window.on('focus', () => {
      this.stateStore.setLastActiveWorkspaceId(workspaceId)
    })

    window.on('close', () => {
      this.saveWindowState(window, workspaceId)
    })

    window.on('closed', () => {
      this.windows.delete(window.id)
      this.workspaceToWindow.delete(workspaceId)
    })
  }

  private saveWindowState(window: BrowserWindow, workspaceId: string): void {
    try {
      const bounds = window.getNormalBounds()
      const state: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: window.isMaximized(),
        fullscreen: window.isFullScreen(),
      }
      this.stateStore.set(workspaceId, state)
    } catch (err) {
      console.error('[window-manager] failed to save window state:', err)
    }
  }

  getWindowById(id: number): AkariWindow | undefined {
    return this.windows.get(id)
  }

  getWorkspaceIdForWindow(windowId: number): string | null {
    return this.windows.get(windowId)?.workspaceId ?? null
  }

  getAllWindows(): AkariWindow[] {
    return Array.from(this.windows.values())
  }
}

export function resolveIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ]
  for (const candidate of candidates) {
    if (require('node:fs').existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}
