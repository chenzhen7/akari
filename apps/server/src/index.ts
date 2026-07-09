import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import fs from 'node:fs'
import type { AgentType, ClientMessage, HookEvent, ServerMessage, SessionStatus } from '@akari/shared-types'
import { createSessionManager, validateTransition } from './session-manager.js'
import { WorkspaceManager } from './workspace-manager.js'
import { CanvasEdgeStore } from './canvas-edge-store.js'
import { dispatchHookEvent } from './hook-dispatcher.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = process.env.REPO_ROOT ? resolve(process.env.REPO_ROOT) : resolve(__dirname, '../../..')
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(__dirname, '..', 'data')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(REPO_ROOT, { recursive: true })

const fastify = Fastify({ logger: { level: 'info' } })

await fastify.register(fastifyCors, { origin: true })
await fastify.register(fastifyWebsocket)

const webDistPath = process.env.WEB_DIST_PATH
if (webDistPath) {
  await fastify.register(fastifyStatic, {
    root: resolve(webDistPath),
    wildcard: false,
  })
  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/ws')) {
      return reply.sendFile('index.html')
    }
    return reply.status(404).send({ error: 'Not Found' })
  })
}

const clients = new Set<WebSocket>()

function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

const db = new Database(join(DATA_DIR, 'akari.db'))
const workspaceManager = new WorkspaceManager(db)
await workspaceManager.migrate()
await workspaceManager.ensureDefaultWorkspace(REPO_ROOT)

const currentWorkspace = workspaceManager.getCurrentWorkspace()!

const sessionManager = await createSessionManager({
  workspacePath: currentWorkspace.path,
  repoRoot: currentWorkspace.repoRoot,
  db,
  broadcast,
  workspaceId: currentWorkspace.id,
  isGitWorkspace: currentWorkspace.isGit,
})

// 迁移旧数据：将无 workspace_id 的 session 关联到默认工作区
db.prepare("UPDATE sessions SET workspace_id = ? WHERE workspace_id = '' OR workspace_id IS NULL").run(currentWorkspace.id)

// 确保当前工作区有主会话
await sessionManager.ensureMainSession(currentWorkspace.path)

const canvasEdgeStore = new CanvasEdgeStore(sessionManager.getDb())
canvasEdgeStore.initDb()

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

fastify.get('/settings', async () => sessionManager.getSettings())

fastify.patch<{ Body: { worktreeBaseDir?: string } }>('/settings', async (request, reply) => {
  const { worktreeBaseDir } = request.body
  if (worktreeBaseDir !== undefined && typeof worktreeBaseDir !== 'string') {
    return reply.status(400).send({ error: 'worktreeBaseDir must be a string' })
  }
  if (worktreeBaseDir) {
    sessionManager.updateSettings({ worktreeBaseDir })
  }
  return sessionManager.getSettings()
})

fastify.get('/repo/branches', async () => sessionManager.getRepoBranches())

fastify.get('/sessions', async () => sessionManager.listSessions())

interface CreateSessionBody {
  name: string
  task: string
  baseBranch?: string
  agentType?: AgentType
  tags?: string[]
  canvasPosition?: { x: number; y: number }
}

fastify.post<{ Body: CreateSessionBody }>('/sessions', async (request, reply) => {
  const { name, task, baseBranch = 'main', agentType = 'claude', tags = [], canvasPosition } = request.body
  if (!name?.trim() || !task?.trim()) {
    return reply.status(400).send({ error: 'name and task are required' })
  }
  try {
    const session = await sessionManager.createSession({ name, task, baseBranch, agentType, tags, canvasPosition })
    return reply.status(201).send(session)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return reply.status(400).send({ error: msg })
  }
})

fastify.patch<{ Params: { id: string }; Body: { status: SessionStatus } }>(
  '/sessions/:id/status',
  async (request, reply) => {
    const { id } = request.params
    const { status } = request.body
    const session = sessionManager.getSession(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    if (!validateTransition(session.status, status)) {
      return reply.status(422).send({ error: `invalid transition: ${session.status} → ${status}` })
    }
    sessionManager.updateStatus(id, status)
    return sessionManager.getSession(id)
  },
)

fastify.post<{ Body: { message: string; targets?: string[] } }>(
  '/broadcast',
  async (request) => {
    const { message, targets } = request.body
    const targetIds = sessionManager.broadcastMessage_legacy(message, targets)
    return { ok: true, targets: targetIds }
  },
)

fastify.post<{ Params: { id: string } }>(
  '/sessions/:id/diff-refresh',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    sessionManager.refreshDiff(id)
    return { ok: true }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { file?: string } }>(
  '/sessions/:id/diff-content',
  async (request, reply) => {
    const { id } = request.params
    const { file } = request.query
    if (!file) return reply.status(400).send({ error: 'file query param is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      const content = await sessionManager.getFileDiffContent(id, file)
      return content
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fastify.log.warn({ err: msg, sessionId: id }, 'getFileDiffContent failed')
      return { original: '', modified: '' }
    }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
  '/sessions/:id/diff-lines',
  async (request, reply) => {
    const { id } = request.params
    const { path: filePath } = request.query
    if (!filePath) return reply.status(400).send({ error: 'path query param is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      const lines = await sessionManager.getFileDiffLines(id, filePath)
      return { lines }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fastify.log.warn({ err: msg, sessionId: id }, 'getFileDiffLines failed')
      return { lines: [] }
    }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
  '/sessions/:id/files',
  async (request, reply) => {
    const { id } = request.params
    const { path: relativePath } = request.query
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      const files = await sessionManager.listFiles(id, relativePath ?? '')
      return files
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fastify.log.warn({ err: msg, sessionId: id }, 'listFiles failed')
      return []
    }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
  '/sessions/:id/file-content',
  async (request, reply) => {
    const { id } = request.params
    const { path: filePath } = request.query
    if (!filePath) return reply.status(400).send({ error: 'path query param is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      const content = await sessionManager.readFileContent(id, filePath)
      return { content }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(404).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string }; Body: { path: string; content: string } }>(
  '/sessions/:id/file-content',
  async (request, reply) => {
    const { id } = request.params
    const { path: filePath, content } = request.body
    if (!filePath || content === undefined) return reply.status(400).send({ error: 'path and content are required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.writeFileContent(id, filePath, content)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { terminalId?: string } }>(
  '/sessions/:id/terminal-buffer',
  async (request, reply) => {
    const { id } = request.params
    const { terminalId } = request.query
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    if (!terminalId) return reply.status(400).send({ error: 'terminalId query param is required' })
    return { buffer: sessionManager.getTerminalBuffer(terminalId) }
  },
)

fastify.post<{ Params: { id: string } }>(
  '/sessions/:id/archive',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      sessionManager.archiveSession(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string } }>(
  '/sessions/:id/restore',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      sessionManager.restoreSession(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string }; Body: HookEvent }>(
  '/sessions/:id/hooks',
  async (request, reply) => {
    const { id } = request.params
    const event = request.body
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      const response = await dispatchHookEvent(id, event, sessionManager)
      return response
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fastify.log.error(`[hooks] dispatchHookEvent error for ${id}: ${msg}`)
      return reply.status(500).send({ error: msg })
    }
  },
)

fastify.patch<{ Params: { id: string }; Body: { x: number; y: number } }>(
  '/sessions/:id/canvas',
  async (request, reply) => {
    const { id } = request.params
    const { x, y } = request.body
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    sessionManager.updateCanvasPosition(id, x, y)
    return { ok: true }
  },
)

fastify.delete<{ Params: { id: string } }>(
  '/sessions/:id',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.deleteSession(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; branch?: string } }>(
  '/sessions/:id/git-log',
  async (request, reply) => {
    const { id } = request.params
    const limit = parseInt(request.query.limit ?? '100') || 100
    const offset = parseInt(request.query.offset ?? '0') || 0
    const branch = request.query.branch
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    return sessionManager.getGitLog(id, limit, offset, branch)
  },
)

fastify.get<{ Params: { id: string } }>(
  '/sessions/:id/git-branches',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    return sessionManager.getGitBranches(id)
  },
)

fastify.post<{ Params: { id: string }; Body: { message: string } }>(
  '/sessions/:id/git/commit',
  async (request, reply) => {
    const { id } = request.params
    const { message } = request.body
    if (!message?.trim()) return reply.status(400).send({ error: 'message is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.commitAll(id, message.trim())
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string }; Body: { sourceBranch: string } }>(
  '/sessions/:id/git/merge',
  async (request, reply) => {
    const { id } = request.params
    const { sourceBranch } = request.body
    if (!sourceBranch?.trim()) return reply.status(400).send({ error: 'sourceBranch is required' })
    const session = sessionManager.getSession(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.worktreeMerge(id, sourceBranch.trim())
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string } }>(
  '/sessions/:id/git/update-branch',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.updateFromBase(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string }; Body: { branch: string; createNew?: boolean } }>(
  '/sessions/:id/git/checkout',
  async (request, reply) => {
    const { id } = request.params
    const { branch, createNew = false } = request.body
    if (!branch?.trim()) return reply.status(400).send({ error: 'branch is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.checkoutBranch(id, branch.trim(), createNew)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string } }>(
  '/sessions/:id/git/discard',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.discardAll(id)
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.post<{ Params: { id: string }; Body: { filePath: string } }>(
  '/sessions/:id/git/discard-file',
  async (request, reply) => {
    const { id } = request.params
    const { filePath } = request.body
    if (!filePath?.trim()) return reply.status(400).send({ error: 'filePath is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      await sessionManager.discardFile(id, filePath.trim())
      return { ok: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

// ─── Workspace endpoints ──────────────────────────────────────────────────────

fastify.get('/workspaces', async () => workspaceManager.listWorkspaces())

fastify.post<{ Body: { name: string; path: string } }>('/workspaces', async (request, reply) => {
  const { name, path } = request.body
  if (!name?.trim() || !path?.trim()) {
    return reply.status(400).send({ error: 'name and path are required' })
  }
  const validation = await workspaceManager.validatePath(path.trim())
  if (!validation.valid) {
    return reply.status(400).send({ error: validation.error })
  }
  const workspace = await workspaceManager.addWorkspace(name.trim(), path.trim())
  broadcast({ event: 'workspace:list', payload: workspaceManager.listWorkspaces() })
  return reply.status(201).send(workspace)
})

fastify.post<{ Params: { id: string } }>('/workspaces/:id/switch', async (request, reply) => {
  const { id } = request.params
  const workspace = workspaceManager.switchWorkspace(id)
  if (!workspace) return reply.status(404).send({ error: 'workspace not found' })
  await sessionManager.setWorkspace(workspace.id, workspace.path, workspace.repoRoot, workspace.isGit)
  await sessionManager.restoreSessions()
  // 先通知客户端清空旧状态，再创建/更新主会话并推送完整列表
  broadcast({ event: 'workspace:current', payload: workspace })
  await sessionManager.ensureMainSession(workspace.path)
  broadcast({ event: 'sessions:list', payload: sessionManager.listSessions() })
  broadcast({ event: 'workspace:list', payload: workspaceManager.listWorkspaces() })
  return { ok: true }
})

fastify.delete<{ Params: { id: string } }>('/workspaces/:id', async (request, reply) => {
  const { id } = request.params
  const deleted = workspaceManager.deleteWorkspace(id)
  if (!deleted) return reply.status(404).send({ error: 'workspace not found' })
  broadcast({ event: 'workspace:list', payload: workspaceManager.listWorkspaces() })
  return { ok: true }
})

// ─── Tab endpoints ────────────────────────────────────────────────────────────

fastify.get<{ Params: { id: string } }>(
  '/sessions/:id/tabs',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    return sessionManager.getTabs(id)
  },
)

fastify.post<{ Params: { id: string }; Body: { type: 'terminal' | 'claude' | 'diff'; filePath?: string } }>(
  '/sessions/:id/tabs',
  async (request, reply) => {
    const { id } = request.params
    const { type, filePath } = request.body
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    try {
      const tab = sessionManager.createTab(id, type, filePath)
      return reply.status(201).send(tab)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(422).send({ error: msg })
    }
  },
)

fastify.delete<{ Params: { id: string; tabId: string } }>(
  '/sessions/:id/tabs/:tabId',
  async (request, reply) => {
    const { id, tabId } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    sessionManager.closeTab(id, tabId)
    return { ok: true }
  },
)

fastify.patch<{ Params: { id: string; tabId: string } }>(
  '/sessions/:id/tabs/:tabId/activate',
  async (request, reply) => {
    const { id, tabId } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    sessionManager.activateTab(id, tabId)
    return { ok: true }
  },
)

// ─── Canvas Edge endpoints ────────────────────────────────────────────────────

fastify.get('/canvas/edges', async () => canvasEdgeStore.getAllEdges())

fastify.post<{
  Body: { sourceSessionId: string; targetSessionId: string; trigger?: 'on-complete'; injectContext?: boolean }
}>(
  '/canvas/edges',
  async (request, reply) => {
    const { sourceSessionId, targetSessionId } = request.body
    if (!sourceSessionId || !targetSessionId) {
      return reply.status(400).send({ error: 'sourceSessionId and targetSessionId are required' })
    }
    const edge = canvasEdgeStore.createEdge(request.body)
    broadcast({ event: 'canvas:edges', payload: canvasEdgeStore.getAllEdges() })
    return reply.status(201).send(edge)
  },
)

fastify.delete<{ Params: { edgeId: string } }>(
  '/canvas/edges/:edgeId',
  async (request, reply) => {
    const { edgeId } = request.params
    const deleted = canvasEdgeStore.deleteEdge(edgeId)
    if (!deleted) return reply.status(404).send({ error: 'edge not found' })
    broadcast({ event: 'canvas:edges', payload: canvasEdgeStore.getAllEdges() })
    return { ok: true }
  },
)

fastify.get('/ws', { websocket: true }, socket => {
  clients.add(socket)
  fastify.log.info(`WebSocket client connected (total: ${clients.size})`)

  if (socket.readyState === WebSocket.OPEN) {
    const currentWs = workspaceManager.getCurrentWorkspace()
    if (currentWs) {
      socket.send(JSON.stringify({ event: 'workspace:current', payload: currentWs }))
    }
    socket.send(JSON.stringify({ event: 'workspace:list', payload: workspaceManager.listWorkspaces() }))
    socket.send(JSON.stringify({ event: 'sessions:list', payload: sessionManager.listSessions() }))
    socket.send(JSON.stringify({ event: 'canvas:edges', payload: canvasEdgeStore.getAllEdges() }))
  }

  // Push current diffs to the newly connected client so DiffViewer restores after refresh
  void (async () => {
    const sessions = sessionManager.listSessions()
    const active = sessions.filter(s => s.worktreePath && !['archived', 'initializing', 'failed'].includes(s.status))
    for (const session of active) {
      try {
        const diff = await sessionManager.getCurrentDiff(session.id)
        if (diff.files.length > 0 && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            event: 'diff:update',
            payload: { sessionId: session.id, diff },
          } satisfies ServerMessage))
        }
      } catch {
        // ignore individual failures
      }
    }
  })()

  socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage
      handleClientMessage(msg)
    } catch {
      fastify.log.warn('Invalid WS message received')
    }
  })

  socket.on('close', () => {
    clients.delete(socket)
    fastify.log.info(`WebSocket client disconnected (total: ${clients.size})`)
  })
})

function handleClientMessage(msg: ClientMessage): void {
  switch (msg.event) {
    case 'terminal:input': {
      const { terminalId, data } = msg.payload
      sessionManager.sendToTerminal(terminalId, data)
      break
    }
    case 'terminal:resize': {
      const { terminalId, cols, rows } = msg.payload
      sessionManager.resizeTerminal(terminalId, cols, rows)
      break
    }
    case 'broadcast:send': {
      const { message, targets } = msg.payload
      sessionManager.broadcastMessage_legacy(message, targets)
      break
    }
    case 'tab:create': {
      const { sessionId, type, filePath } = msg.payload
      try {
        sessionManager.createTab(sessionId, type, filePath)
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'tab:create failed')
      }
      break
    }
    case 'tab:close': {
      const { sessionId, tabId } = msg.payload
      sessionManager.closeTab(sessionId, tabId)
      break
    }
    case 'tab:activate': {
      const { sessionId, tabId } = msg.payload
      sessionManager.activateTab(sessionId, tabId)
      break
    }
    case 'tab:reorder': {
      const { sessionId, orderedTabIds } = msg.payload
      sessionManager.reorderTabs(sessionId, orderedTabIds)
      break
    }
    case 'terminal:create': {
      const { sessionId, agentType } = msg.payload
      try {
        sessionManager.createTab(sessionId, agentType ? 'claude' : 'terminal', undefined, agentType)
      } catch (err) {
        fastify.log.warn({ err, sessionId, agentType }, 'terminal:create failed')
      }
      break
    }
  }
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
