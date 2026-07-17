import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import fs from 'node:fs'
import type { ServerMessage } from '@akari/shared-types'
import { createSessionManager, type SessionManager } from './session-manager.js'
import { WorkspaceManager } from './workspace-manager.js'
import { CanvasEdgeStore } from './canvas-edge-store.js'
import { WorkspaceSessionRegistry } from './workspace-session-registry.js'

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
const workspaceManager = new WorkspaceManager(db)
await workspaceManager.migrate()
await workspaceManager.ensureDefaultWorkspace(REPO_ROOT)

const clients = new Set<WebSocket>()
const workspaceClients = new Map<WebSocket, string>()

function broadcast(message: ServerMessage, workspaceId?: string): void {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue
    if (workspaceId && workspaceClients.get(ws) !== workspaceId) continue
    ws.send(data)
  }
}

const workspaceSessionManagers = new Map<string, SessionManager>()

async function getOrCreateSessionManager(workspaceId: string): Promise<SessionManager> {
  const existing = workspaceSessionManagers.get(workspaceId)
  if (existing) return existing

  const workspace = workspaceManager.getWorkspaceById(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }

  const manager = await createSessionManager({
    workspacePath: workspace.path,
    repoRoot: workspace.repoRoot,
    db,
    broadcast: (msg) => broadcast(msg, workspaceId),
    workspaceId: workspace.id,
    isGitWorkspace: workspace.isGit,
  })

  workspaceSessionManagers.set(workspaceId, manager)
  return manager
}

const workspaceSessionRegistry = new WorkspaceSessionRegistry({
  getOrCreateSessionManager,
  sessionManagers: workspaceSessionManagers,
  ttlMs: 30000,
  onDispose: (workspaceId) => {
    fastify.log.info(`SessionManager for workspace ${workspaceId} disposed after inactivity`)
  },
})

const currentWorkspace = workspaceManager.getCurrentWorkspace()!

const sessionManager = await getOrCreateSessionManager(currentWorkspace.id)

// 迁移旧数据：将无 workspace_id 的 session 关联到默认工作区
db.prepare("UPDATE sessions SET workspace_id = ? WHERE workspace_id = '' OR workspace_id IS NULL").run(currentWorkspace.id)

// 确保当前工作区有主会话
await sessionManager.ensureMainSession(currentWorkspace.path)

const canvasEdgeStore = new CanvasEdgeStore(db)

fastify.decorate('db', db)
fastify.decorate('workspaceManager', workspaceManager)
fastify.decorate('sessionManager', sessionManager)
fastify.decorate('canvasEdgeStore', canvasEdgeStore)
fastify.decorate('clients', clients)
fastify.decorate('workspaceClients', workspaceClients)
fastify.decorate('broadcast', broadcast)
fastify.decorate('getOrCreateSessionManager', getOrCreateSessionManager)
fastify.decorate('workspaceSessionRegistry', workspaceSessionRegistry)

fastify.addHook('preHandler', async (request) => {
  const workspaceId =
    (request.headers['x-workspace-id'] as string | undefined)
    ?? (request.query as Record<string, unknown> | undefined)?.workspaceId as string | undefined
    ?? workspaceManager.getCurrentWorkspace()?.id

  request.workspaceId = workspaceId
  request.sessionManager = workspaceId
    ? await getOrCreateSessionManager(workspaceId)
    : sessionManager
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

  // The singleton sessionManager for the default workspace may not be tracked by the registry
  // if no WebSocket client ever subscribed to it. Ensure it is disposed as well.
  if (sessionManager && !sessionManager.isDisposed) {
    await sessionManager.dispose().catch((err: unknown) => {
      console.error('[shutdown] dispose default sessionManager failed:', err)
    })
  }

  await fastify.close()
  db.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
