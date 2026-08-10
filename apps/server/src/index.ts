import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import fs from 'node:fs'
import type { ServerMessage, Workspace } from '@akari/shared-types'
import { getGitRoot } from './infrastructure/git/git-utils.js'
import { createSessionManager, type SessionManager } from './session-manager.js'
import { WorkspaceService } from './services/workspace.service.js'
import { CanvasEdgeStore } from './infrastructure/db/canvas-edge-store.js'
import { WorkspaceSessionRegistryService } from './services/workspace-session-registry.service.js'
import { perfLog, perfNow } from './perf-log.js'

import websocketPlugin from './plugins/websocket.js'
import staticPlugin from './plugins/static.js'
import healthRoutes from './routes/health.js'
import settingsRoutes from './routes/settings.js'
import repoRoutes from './routes/repo.js'
import sessionsRoutes from './routes/sessions.js'
import gitRoutes from './routes/git.js'
import filesRoutes from './routes/files.js'
import diffRoutes from './routes/diff.js'
import terminalRoutes from './routes/terminal.js'
import tabsRoutes from './routes/tabs.js'
import workspaceRoutes from './routes/workspace.js'
import canvasRoutes from './routes/canvas.js'
import hooksRoutes from './routes/hooks.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(__dirname, '../../..')
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(__dirname, '..', 'data')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(REPO_ROOT, { recursive: true })

const fastify = Fastify({ logger: { level: 'info' } })

await fastify.register(fastifyCors, { origin: true })
await fastify.register(fastifyWebsocket)

const db = new Database(join(DATA_DIR, 'akari.db'))
const workspaceManager = new WorkspaceService(db)
await workspaceManager.migrate()
await workspaceManager.ensureDefaultWorkspace(REPO_ROOT)

const workspaceSessionManagers = new Map<string, SessionManager>()
const pendingSessionManagers = new Map<string, Promise<SessionManager>>()

let currentSocket: WebSocket | null = null
let currentWorkspaceId: string | null = null

const wsState = {
  get socket() {
    return currentSocket
  },
  set socket(value: WebSocket | null) {
    currentSocket = value
  },
  get workspaceId() {
    return currentWorkspaceId
  },
  set workspaceId(value: string | null) {
    currentWorkspaceId = value
  },
}

function broadcast(message: ServerMessage, workspaceId?: string): void {
  const ws = currentSocket
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  if (workspaceId && currentWorkspaceId !== workspaceId) return
  ws.send(JSON.stringify(message))
}

/**
 * 重探测 workspace 的 git 状态并同步 DB / 运行时 SessionManager。
 * 覆盖「外部 git init / 仓库被移除」后 DB 过期的问题。
 * 仅 false→true 时翻转运行时状态；true→false 只改 DB（运行中删除 .git 属边界情况，不额外处理）。
 */
async function syncWorkspaceGitState(workspace: Workspace): Promise<Workspace> {
  const gitRoot = await getGitRoot(workspace.path)
  const isGit = gitRoot !== null
  const repoRoot = gitRoot ?? workspace.path
  if (workspace.isGit === isGit && workspace.repoRoot === repoRoot) {
    return workspace
  }
  const updated = workspaceManager.updateGitState(workspace.id, repoRoot, isGit) ?? workspace
  if (isGit) {
    const existing = workspaceSessionManagers.get(workspace.id)
    if (existing) {
      await existing.enableGitWorkspace(repoRoot).catch((err: unknown) => {
        fastify.log.warn({ err, workspaceId: workspace.id }, 'syncWorkspaceGitState: enableGitWorkspace failed')
      })
    }
  }
  return updated
}

async function getOrCreateSessionManager(workspaceId: string): Promise<SessionManager> {
  const existing = workspaceSessionManagers.get(workspaceId)
  if (existing) return existing

  const inFlight = pendingSessionManagers.get(workspaceId)
  if (inFlight) return inFlight

  const promise = (async (): Promise<SessionManager> => {
    try {
      const workspace = workspaceManager.getWorkspaceById(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      // 创建 manager 前先重探测 git 状态，确保用最新 isGit/repoRoot 组装运行时
      const synced = await syncWorkspaceGitState(workspace)

      const tCreate = perfNow()
      const manager = await createSessionManager({
        workspacePath: synced.path,
        repoRoot: synced.repoRoot,
        db,
        broadcast: (msg) => broadcast(msg, workspaceId),
        workspaceId: synced.id,
        isGitWorkspace: synced.isGit,
      })
      perfLog(`[startup] createSessionManager（含 restoreSessions）`, tCreate)

      const tMain = perfNow()
      await manager.ensureMainSession(workspace.path)
      perfLog(`[startup] ensureMainSession`, tMain)
      workspaceSessionManagers.set(workspaceId, manager)
      return manager
    } finally {
      pendingSessionManagers.delete(workspaceId)
    }
  })()

  pendingSessionManagers.set(workspaceId, promise)
  return promise
}

const workspaceSessionRegistry = new WorkspaceSessionRegistryService({
  getOrCreateSessionManager,
  sessionManagers: workspaceSessionManagers,
  onDispose: (workspaceId) => {
    fastify.log.info(`SessionManager for workspace ${workspaceId} disposed`)
  },
})

// 迁移旧数据：将无 workspace_id 的 session 关联到第一个工作区（任意一个即可，因为后续访问都会按 workspace 隔离）
const firstWorkspace = workspaceManager.listWorkspaces()[0]
if (firstWorkspace) {
  db.prepare("UPDATE sessions SET workspace_id = ? WHERE workspace_id = '' OR workspace_id IS NULL").run(firstWorkspace.id)
}

const canvasEdgeStore = new CanvasEdgeStore(db)

fastify.decorate('db', db)
fastify.decorate('workspaceManager', workspaceManager)
fastify.decorate('canvasEdgeStore', canvasEdgeStore)
fastify.decorate('wsState', wsState)
fastify.decorate('broadcast', broadcast)
fastify.decorate('getOrCreateSessionManager', getOrCreateSessionManager)
fastify.decorate('syncWorkspaceGitState', syncWorkspaceGitState)
fastify.decorate('workspaceSessionRegistry', workspaceSessionRegistry)

fastify.addHook('preHandler', async (request, reply) => {
  const path = request.url.split('?')[0]

  // Static files and SPA fallback: skip workspace scoping.
  if (
    path === '/' ||
    path === '/index.html' ||
    path.startsWith('/assets/') ||
    /\.[a-zA-Z0-9]+$/.test(path)
  ) {
    return
  }

  // Health check and WebSocket upgrade: skip.
  if (path === '/health' || path === '/ws') {
    return
  }

  // Global workspace management routes: skip.
  if (path.startsWith('/workspaces') || path.startsWith('/settings')) {
    return
  }

  let workspaceId =
    (request.headers['x-workspace-id'] as string | undefined)
    ?? (request.query as Record<string, unknown> | undefined)?.workspaceId as string | undefined

  // HTTP hooks from external agents only include the sessionId; resolve workspace from DB.
  const hooksMatch = /^\/sessions\/([^/]+)\/hooks$/.exec(path)
  if (hooksMatch && !workspaceId) {
    const sessionId = hooksMatch[1]
    const row = db.prepare('SELECT workspace_id FROM sessions WHERE id = ?').get(sessionId) as { workspace_id: string } | undefined
    workspaceId = row?.workspace_id
  }

  if (!workspaceId) {
    return reply.status(400).send({ error: 'workspaceId is required via X-Workspace-Id header or workspaceId query param' })
  }

  request.workspaceId = workspaceId
  const t0 = perfNow()
  request.sessionManager = await getOrCreateSessionManager(workspaceId)
  perfLog(`[preHandler] getOrCreateSessionManager ${request.url.split('?')[0]}`, t0)
})

await fastify.register(healthRoutes)
await fastify.register(settingsRoutes)
await fastify.register(repoRoutes)
await fastify.register(sessionsRoutes)
await fastify.register(gitRoutes)
await fastify.register(filesRoutes)
await fastify.register(diffRoutes)
await fastify.register(terminalRoutes)
await fastify.register(tabsRoutes)
await fastify.register(workspaceRoutes)
await fastify.register(canvasRoutes)
await fastify.register(hooksRoutes)
await fastify.register(websocketPlugin)
await fastify.register(staticPlugin)

if (process.env.WEB_DIST_PATH) {
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/ws')) {
      return reply.sendFile('index.html')
    }
    return reply.status(404).send({ error: 'Not Found' })
  })
}

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

try {
  await fastify.listen({ port: PORT, host: HOST })
  const address = fastify.server.address()
  const actualPort = typeof address === 'object' && address ? address.port : PORT
  // 用实际绑定的端口回填 process.env.PORT，供 ClaudeAdapter 生成正确的 Hook URL。
  // 打包环境下 desktop 以 PORT=0 启动（随机端口），若不回填，Hook URL 会写成 http://localhost:0/... 导致 Hook 失效。
  process.env.PORT = String(actualPort)
  console.log(`AKARI_PORT=${actualPort}`)
  console.log(`🚀 Akari server running on http://localhost:${actualPort}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}

async function shutdown(signal: string): Promise<void> {
  fastify.log.info(`Received ${signal}, disposing all session managers...`)
  await workspaceSessionRegistry.disposeAll()

  await fastify.close()
  db.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
