import { app, BrowserWindow, dialog, shell, Menu, ipcMain, clipboard } from 'electron'
import log from 'electron-log/main'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { WindowManager } from './window-manager.js'
import { WindowStateStore } from './window-state-store.js'

interface WorkspaceSummary {
  id: string
  name: string
  path: string
  repoRoot: string
  isGit: boolean
  createdAt?: string
  lastOpenedAt?: string
}

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

let serverProcess: ChildProcess | null = null
let serverPort: number | null = null
let windowManager: WindowManager | null = null
let windowStateStore: WindowStateStore | null = null

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err)
  app.quit()
})

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
})

log.transports.file.level = 'info'

function getServerUrl(): string {
  if (isDev) {
    return 'http://localhost:5173'
  }
  return `http://localhost:${serverPort ?? 43917}`
}

function findServerEntry(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'server', 'index.js'),
    path.join(__dirname, '..', '..', 'server', 'index.js'),
    path.join(__dirname, '..', 'server', 'index.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function findWebDistPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'web', 'dist'),
    path.join(__dirname, '..', '..', 'web', 'dist'),
    path.join(__dirname, '..', 'web', 'dist'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function startServer(): Promise<number> {
  const serverEntry = findServerEntry()
  if (!serverEntry) {
    throw new Error('Server entry not found')
  }

  const webDistPath = findWebDistPath()
  if (!webDistPath) {
    throw new Error('Web dist not found')
  }

  const userData = app.getPath('userData')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // 固定一个不常见端口，保证重启后端口不变。
    // Claude Hook URL 被写死进各 worktree 的 .claude/settings.local.json，
    // 若用随机端口(0)，重启后端口变化会导致旧会话的 Hook 指向失效端口。
    PORT: '43917',
    REPO_ROOT: userData,
    DATA_DIR: path.join(userData, 'data'),
    WEB_DIST_PATH: webDistPath,
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [serverEntry], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    serverProcess = proc

    let stdout = ''
    let stderr = ''
    let settled = false

    const cleanup = (): void => {
      settled = true
    }

    const timeout = setTimeout(() => {
      if (settled) return
      proc.kill()
      cleanup()
      reject(new Error('Server start timeout'))
    }, 30000)

    const onData = (data: Buffer): void => {
      if (settled) return
      const chunk = data.toString()
      stdout += chunk
      log.info('[server]', chunk.trim())
      const match = /AKARI_PORT=(\d+)/.exec(stdout)
      if (match) {
        clearTimeout(timeout)
        cleanup()
        serverPort = parseInt(match[1], 10)
        resolve(serverPort)
      }
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      log.error('[server]', chunk.trim())
    })

    proc.on('error', (err) => {
      if (settled) return
      clearTimeout(timeout)
      cleanup()
      reject(err)
    })

    proc.on('exit', (code) => {
      if (settled) return
      clearTimeout(timeout)
      cleanup()
      reject(new Error(`Server exited with code ${code ?? 'unknown'}\n${stderr}`))
    })
  })
}

function getApiBasePath(): string {
  // In dev, the Vite dev server proxies /api to the backend.
  // In production, the backend serves the API directly at the root path.
  return isDev ? '/api/workspaces' : '/workspaces'
}

async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const res = await fetch(`${getServerUrl()}${getApiBasePath()}`)
  if (!res.ok) {
    throw new Error(`无法获取工作区列表：HTTP ${res.status}`)
  }
  return (await res.json()) as WorkspaceSummary[]
}

function getSenderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function registerGlobalIpcHandlers(): void {
  // Window control IPC handlers (target the sender window)
  ipcMain.handle('window-minimize', (event) => {
    getSenderWindow(event)?.minimize()
  })

  ipcMain.handle('window-maximize', (event) => {
    const win = getSenderWindow(event)
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.handle('window-close', (event) => {
    getSenderWindow(event)?.close()
  })

  ipcMain.handle('window-is-maximized', (event) => {
    return getSenderWindow(event)?.isMaximized() ?? false
  })

  ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
    const win = getSenderWindow(event)
    if (win) {
      return dialog.showOpenDialog(win, options)
    }
    return dialog.showOpenDialog(options)
  })

  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    return shell.openPath(filePath)
  })

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('app:get-log-path', () => {
    return log.transports.file.getFile().path
  })
}

async function main(): Promise<void> {
  await app.whenReady()

  Menu.setApplicationMenu(null)
  registerGlobalIpcHandlers()

  windowStateStore = new WindowStateStore()

  if (!isDev) {
    try {
      await startServer()
    } catch (err) {
      dialog.showErrorBox('启动失败', err instanceof Error ? err.message : String(err))
      app.quit()
      return
    }
  }

  const loadUrl = getServerUrl()
  windowManager = new WindowManager({
    loadUrl,
    preloadPath: path.join(__dirname, 'preload.js'),
    stateStore: windowStateStore,
    isDev,
  })
  windowManager.registerIpcHandlers()

  let workspaces: WorkspaceSummary[]
  try {
    workspaces = await fetchWorkspaces()
  } catch (err) {
    dialog.showErrorBox('启动失败', err instanceof Error ? err.message : String(err))
    app.quit()
    return
  }

  if (workspaces.length === 0) {
    dialog.showErrorBox('启动失败', '没有可用工作区')
    app.quit()
    return
  }

  await windowManager.restoreWindows(workspaces)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        const allWorkspaces = await fetchWorkspaces()
        const lastActiveId = windowStateStore?.getLastActiveWorkspaceId()
        const workspaceToOpen = allWorkspaces.find(w => w.id === lastActiveId) ?? allWorkspaces[0]
        if (workspaceToOpen) {
          await windowManager?.openWorkspaceWindow(workspaceToOpen.id, workspaceToOpen.name)
        }
      } catch (err) {
        dialog.showErrorBox('恢复窗口失败', err instanceof Error ? err.message : String(err))
      }
    }
  })
}

app.on('before-quit', () => {
  windowManager?.flushState()
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM')
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL')
      }
    }, 5000)
  }
})

app.on('will-quit', () => {
  windowManager?.flushState()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

void main().catch((err) => {
  log.error(err)
  app.quit()
})
