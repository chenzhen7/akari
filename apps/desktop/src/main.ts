import { app, BrowserWindow, dialog, shell, Menu, ipcMain, clipboard } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let serverPort: number | null = null

function resolveIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

function createWindow(loadUrl: string): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    icon: resolveIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[desktop] failed to load ${loadUrl}: ${errorCode} ${errorDescription}`)
    dialog.showErrorBox('加载失败', `${loadUrl}\n${errorDescription} (${errorCode})`)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  Menu.setApplicationMenu(null)

  // Window control IPC handlers
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow?.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle('window-close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow?.isMaximized() ?? false
  })

  // Native file/folder picker IPC handler
  ipcMain.handle('dialog:showOpenDialog', async (_event, options) => {
    if (!mainWindow) {
      throw new Error('Main window is not ready')
    }
    return dialog.showOpenDialog(mainWindow, options)
  })

  // Open local file/folder in system default application
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    return shell.openPath(filePath)
  })

  // Write text to the system clipboard from the renderer
  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text)
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized-change', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized-change', false)
  })

  void mainWindow.loadURL(loadUrl)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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

async function main(): Promise<void> {
  await app.whenReady()

  if (isDev) {
    createWindow('http://localhost:5173')
  } else {
    try {
      const port = await startServer()
      createWindow(`http://localhost:${port}`)
    } catch (err) {
      dialog.showErrorBox('启动失败', err instanceof Error ? err.message : String(err))
      app.quit()
      return
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const url = isDev ? 'http://localhost:5173' : `http://localhost:${serverPort ?? 3001}`
      createWindow(url)
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
