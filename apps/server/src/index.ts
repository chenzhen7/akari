import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { AgentType, ClientMessage, HookEvent, ServerMessage, SessionStatus } from '@akari/shared-types'
import { createSessionManager, validateTransition } from './session-manager.js'
import { WorkspaceManager } from './workspace-manager.js'
import { CanvasEdgeStore } from './canvas-edge-store.js'
import { dispatchHookEvent } from './hook-dispatcher.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '../../..')
const DATA_DIR = join(__dirname, '..', 'data')

const fastify = Fastify({ logger: { level: 'info' } })

await fastify.register(fastifyCors, { origin: true })
await fastify.register(fastifyWebsocket)

const clients = new Set<WebSocket>()

function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

const db = new Database(join(DATA_DIR, 'akari.db'))
const workspaceManager = new WorkspaceManager(db)
workspaceManager.ensureDefaultWorkspace(REPO_ROOT)

const currentWorkspace = workspaceManager.getCurrentWorkspace()!

const sessionManager = await createSessionManager({
  repoPath: currentWorkspace.path,
  db,
  broadcast,
  workspaceId: currentWorkspace.id,
})

// 迁移旧数据：将无 workspace_id 的 session 关联到默认工作区
db.prepare("UPDATE sessions SET workspace_id = ? WHERE workspace_id = '' OR workspace_id IS NULL").run(currentWorkspace.id)

const canvasEdgeStore = new CanvasEdgeStore(sessionManager.getDb())
canvasEdgeStore.initDb()

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

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
  const session = await sessionManager.createSession({ name, task, baseBranch, agentType, tags, canvasPosition })
  return reply.status(201).send(session)
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

fastify.post<{ Params: { id: string }; Body: { decision: 'approved' | 'rejected'; comment?: string; approvalOption?: string } }>(
  '/sessions/:id/approval',
  async (request, reply) => {
    const { id } = request.params
    const { decision, comment, approvalOption } = request.body
    const session = sessionManager.getSession(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    if (session.status !== 'waiting') {
      fastify.log.warn({ sessionId: id, currentStatus: session.status }, '[approval] not in waiting state')
      return reply.status(422).send({ error: 'session is not waiting for approval' })
    }
    fastify.log.info({ sessionId: id, decision, approvalOption }, '[approval] calling handleApproval')
    sessionManager.handleApproval(id, decision, comment, approvalOption)
    return { ok: true }
  },
)

// 忽略审批：清除 hook 的等待，让 Claude Code 自己处理（不解锁 PTY）
fastify.post<{ Params: { id: string } }>(
  '/sessions/:id/approval-ignore',
  async (request, reply) => {
    const { id } = request.params
    const session = sessionManager.getSession(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    sessionManager.dismissApproval(id)
    return { ok: true }
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

fastify.get<{ Params: { id: string }; Querystring: { file?: string } }>(
  '/sessions/:id/diff-content',
  async (request, reply) => {
    const { id } = request.params
    const { file } = request.query
    if (!file) return reply.status(400).send({ error: 'file query param is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    const content = await sessionManager.getFileDiffContent(id, file)
    return content
  },
)

fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
  '/sessions/:id/diff-lines',
  async (request, reply) => {
    const { id } = request.params
    const { path: filePath } = request.query
    if (!filePath) return reply.status(400).send({ error: 'path query param is required' })
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    const lines = await sessionManager.getFileDiffLines(id, filePath)
    return { lines }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
  '/sessions/:id/files',
  async (request, reply) => {
    const { id } = request.params
    const { path: relativePath } = request.query
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    const files = await sessionManager.listFiles(id, relativePath ?? '')
    return files
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
    sessionManager.archiveSession(id)
    return { ok: true }
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
    await sessionManager.deleteSession(id)
    return { ok: true }
  },
)

fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
  '/sessions/:id/git-log',
  async (request, reply) => {
    const { id } = request.params
    const limit = parseInt(request.query.limit ?? '100') || 100
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    return sessionManager.getGitLog(id, limit)
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
  const workspace = workspaceManager.addWorkspace(name.trim(), path.trim())
  broadcast({ event: 'workspace:list', payload: workspaceManager.listWorkspaces() })
  return reply.status(201).send(workspace)
})

fastify.post<{ Params: { id: string } }>('/workspaces/:id/switch', async (request, reply) => {
  const { id } = request.params
  const workspace = workspaceManager.switchWorkspace(id)
  if (!workspace) return reply.status(404).send({ error: 'workspace not found' })
  sessionManager.setWorkspace(workspace.id, workspace.path)
  await sessionManager.restoreSessions()
  broadcast({ event: 'workspace:current', payload: workspace })
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

// ─── Filesystem endpoints ─────────────────────────────────────────────────────

fastify.get<{ Querystring: { path?: string } }>('/fs/list', async (request, reply) => {
  const { path: dirPath } = request.query
  if (!dirPath) {
    // Return drives on Windows, root on other platforms
    const drives = await workspaceManager.listDrives()
    return {
      entries: drives.map(d => ({ name: d.name, path: d.path, type: 'directory' as const })),
      currentPath: '',
      parentPath: null,
    }
  }
  return workspaceManager.listDirectory(dirPath)
})

fastify.get('/fs/drives', async () => workspaceManager.listDrives())

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
  Body: { sourceSessionId: string; targetSessionId: string; trigger?: 'on-complete' | 'on-approval'; injectContext?: boolean }
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
    case 'approval:decision': {
      const { sessionId, decision, comment } = msg.payload
      sessionManager.handleApproval(sessionId, decision, comment)
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
      const { sessionId } = msg.payload
      try {
        sessionManager.createTab(sessionId, 'terminal')
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'terminal:create failed')
      }
      break
    }
  }
}

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '0.0.0.0'

try {
  await fastify.listen({ port: PORT, host: HOST })
  console.log(`🚀 Akari server running on http://localhost:${PORT}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
