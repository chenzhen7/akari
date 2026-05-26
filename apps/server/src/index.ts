import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { ClientMessage, ServerMessage, SessionStatus } from '@akari/shared-types'
import { createSessionManager, validateTransition } from './session-manager.js'

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

const sessionManager = await createSessionManager({
  repoPath: REPO_ROOT,
  dbPath: join(DATA_DIR, 'akari.db'),
  broadcast,
})

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

fastify.get('/sessions', async () => sessionManager.listSessions())

interface CreateSessionBody {
  name: string
  task: string
  baseBranch?: string
  agentType?: 'claude' | 'aider' | 'shell'
  tags?: string[]
}

fastify.post<{ Body: CreateSessionBody }>('/sessions', async (request, reply) => {
  const { name, task, baseBranch = 'main', agentType = 'claude', tags = [] } = request.body
  if (!name?.trim() || !task?.trim()) {
    return reply.status(400).send({ error: 'name and task are required' })
  }
  const session = await sessionManager.createSession({ name, task, baseBranch, agentType, tags })
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

fastify.post<{ Params: { id: string }; Body: { decision: 'approved' | 'rejected'; comment?: string } }>(
  '/sessions/:id/approval',
  async (request, reply) => {
    const { id } = request.params
    const { decision, comment } = request.body
    const session = sessionManager.getSession(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    if (session.status !== 'waiting') {
      return reply.status(422).send({ error: 'session is not waiting for approval' })
    }
    sessionManager.handleApproval(id, decision, comment)
    return { ok: true }
  },
)

fastify.post<{ Body: { message: string; targets?: string[] } }>(
  '/broadcast',
  async (request) => {
    const { message, targets } = request.body
    const targetIds = sessionManager.broadcastMessage(message, targets)
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

fastify.get<{ Params: { id: string } }>(
  '/sessions/:id/terminal-buffer',
  async (request, reply) => {
    const { id } = request.params
    if (!sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
    return { buffer: sessionManager.getTerminalBuffer(id) }
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

fastify.get('/ws', { websocket: true }, socket => {
  clients.add(socket)
  fastify.log.info(`WebSocket client connected (total: ${clients.size})`)

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ event: 'sessions:list', payload: sessionManager.listSessions() }))
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
      const { sessionId, data } = msg.payload
      sessionManager.sendToTerminal(sessionId, data)
      break
    }
    case 'terminal:resize': {
      const { sessionId, cols, rows } = msg.payload
      sessionManager.resizeTerminal(sessionId, cols, rows)
      break
    }
    case 'approval:decision': {
      const { sessionId, decision, comment } = msg.payload
      sessionManager.handleApproval(sessionId, decision, comment)
      break
    }
    case 'broadcast:send': {
      const { message, targets } = msg.payload
      sessionManager.broadcastMessage(message, targets)
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
