import { app, BrowserWindow, dialog, shell, Menu, ipcMain, clipboard } from 'electron'
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
  isCurrent: boolean
  createdAt?: string
  lastOpenedAt?: string
}

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

let serverProcess: ChildProcess | null = null
let serverPort: number | null = null
let windowManager: WindowManager | null = null
let windowStateStore: WindowStateStore | null = null

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
      console.log('[server]', chunk.trim())
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
      console.error('[server]', chunk.trim())
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

async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  try {
    const res = await fetch(`${getServerUrl()}/api/workspaces`)
    if (!res.ok) return []
    return (await res.json()) as WorkspaceSummary[]
  } catch (err) {
    console.error('[desktop] failed to fetch workspaces:', err)
    return []
  }
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

  const workspaces = await fetchWorkspaces()
  if (workspaces.length > 0) {
    await windowManager.restoreWindows(workspaces)
  } else {
    dialog.showErrorBox('启动失败', '无法获取工作区列表')
    app.quit()
    return
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const allWorkspaces = await fetchWorkspaces()
      const lastActiveId = windowStateStore?.getLastActiveWorkspaceId()
      const workspaceToOpen = allWorkspaces.find(w => w.id === lastActiveId) ?? allWorkspaces.find(w => w.isCurrent) ?? allWorkspaces[0]
      if (workspaceToOpen) {
        await windowManager?.openWorkspaceWindow(workspaceToOpen.id)
      }
    }
  })
}

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM')
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL')
      }
    }, 5000)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

void main().catch((err) => {
  console.error(err)
  app.quit()
})
