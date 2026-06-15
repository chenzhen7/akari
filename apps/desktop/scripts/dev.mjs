import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '../..')

const BACKEND_URL = 'http://localhost:3001/health'
const FRONTEND_URL = 'http://localhost:5173'

function startBackend() {
  return spawn('pnpm', ['--filter', '@akari/server', 'dev'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  })
}

function startFrontend() {
  return spawn(
    'pnpm',
    ['--filter', '@akari/web', 'dev', '--', '--port', '5173', '--strictPort'],
    {
      cwd: rootDir,
      env: { ...process.env, VITE_API_URL: 'http://localhost:3001' },
      stdio: 'inherit',
      shell: true,
    }
  )
}

function startElectron() {
  return spawn('pnpm', ['--filter', '@akari/desktop', 'dev'], {
    cwd: rootDir,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
    shell: true,
  })
}

async function waitForUrl(url, label, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        console.log(`[dev] ${label} ready: ${url}`)
        return
      }
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timeout waiting for ${label} at ${url}`)
}

function killTree(proc, label) {
  if (!proc || proc.killed || proc.exitCode !== null) return
  console.log(`[dev] stopping ${label} (pid ${proc.pid})`)
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { shell: true })
  } else {
    proc.kill('SIGTERM')
  }
}

async function main() {
  const backend = startBackend()
  const frontend = startFrontend()

  let electron = null

  const cleanup = (code = 0) => {
    killTree(electron, 'electron')
    killTree(frontend, 'frontend')
    killTree(backend, 'backend')
    setTimeout(() => process.exit(code), 500)
  }

  process.on('SIGINT', () => cleanup(0))
  process.on('SIGTERM', () => cleanup(0))

  try {
    await waitForUrl(BACKEND_URL, 'backend', 60000)
    await waitForUrl(FRONTEND_URL, 'frontend', 60000)
  } catch (err) {
    console.error(`[dev] ${err.message}`)
    cleanup(1)
    return
  }

  electron = startElectron()

  electron.on('exit', (code) => {
    console.log(`[dev] electron exited with code ${code ?? 'unknown'}`)
    cleanup(code ?? 0)
  })

  electron.on('error', (err) => {
    console.error('[dev] electron error:', err)
    cleanup(1)
  })
}

main().catch((err) => {
  console.error('[dev] fatal:', err)
  process.exit(1)
})
