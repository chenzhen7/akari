import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { WindowStateStore, type WindowState } from './window-state-store.js'

export interface WindowManagerOptions {
  loadUrl: string
  preloadPath: string
  stateStore: WindowStateStore
  isDev: boolean
}

interface WorkspaceSummary {
  id: string
  name: string
  path: string
  repoRoot: string
  isGit: boolean
  createdAt?: string
  lastOpenedAt?: string
}

const DEFAULT_WIDTH = 1400
const DEFAULT_HEIGHT = 900
const MIN_WIDTH = 900
const MIN_HEIGHT = 600

export class WindowManager {
  private window: BrowserWindow | null = null
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
    ipcMain.handle('workspace:set-active-workspace-id', (_event: IpcMainInvokeEvent, workspaceId: string) => {
      this.stateStore.setLastActiveWorkspaceId(workspaceId)
    })

    ipcMain.handle('workspace:notify-deleted', (_event: IpcMainInvokeEvent, workspaceId: string) => {
      if (this.stateStore.getLastActiveWorkspaceId() === workspaceId) {
        this.stateStore.setLastActiveWorkspaceId(undefined)
      }
    })
  }

  async restoreWindow(workspaces: WorkspaceSummary[]): Promise<void> {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore()
      }
      this.window.focus()
      return
    }

    const lastActiveId = this.stateStore.getLastActiveWorkspaceId()
    const workspace = workspaces.find(w => w.id === lastActiveId) ?? workspaces[0]
    await this.openWindow(workspace?.id)
  }

  async openWindow(workspaceId?: string): Promise<BrowserWindow> {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore()
      }
      this.window.focus()
      return this.window
    }

    const state = this.stateStore.getWindowState()
    const window = this.createBrowserWindow(state)
    const url = this.buildLoadUrl(workspaceId)
    await window.loadURL(url)

    this.window = window
    this.attachWindowListeners(window)

    return window
  }

  private createBrowserWindow(state?: WindowState): BrowserWindow {
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

    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        window.webContents.toggleDevTools()
      }
    })

    return window
  }

  private buildLoadUrl(workspaceId?: string): string {
    const url = new URL(this.loadUrl)
    if (workspaceId) {
      url.searchParams.set('workspaceId', workspaceId)
    }
    return url.toString()
  }

  private attachWindowListeners(window: BrowserWindow): void {
    window.once('ready-to-show', () => {
      window.show()
      if (this.isDev) {
        window.webContents.openDevTools()
      }
    })

    const debouncedSave = debounce(() => {
      this.saveWindowState(window)
    }, 500)

    window.on('move', debouncedSave)
    window.on('resize', debouncedSave)

    window.on('close', () => {
      debouncedSave.flush()
      this.saveWindowState(window)
    })

    window.on('closed', () => {
      this.window = null
    })
  }

  private saveWindowState(window: BrowserWindow): void {
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
      this.stateStore.setWindowState(state)
    } catch (err) {
      console.error('[window-manager] failed to save window state:', err)
    }
  }

  flushState(): void {
    this.stateStore.flush()
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

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): { (...args: Parameters<T>): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  let lastArgs: Parameters<T> | null = null

  const run = (): void => {
    pending = false
    timer = null
    if (lastArgs) {
      fn(...lastArgs)
      lastArgs = null
    }
  }

  const debounced = (...args: Parameters<T>): void => {
    lastArgs = args
    pending = true
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(run, ms)
  }

  debounced.flush = (): void => {
    if (timer) {
      clearTimeout(timer)
    }
    if (pending) {
      run()
    }
  }

  return debounced
}
