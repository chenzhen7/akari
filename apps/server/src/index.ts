import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import { WebSocket } from 'ws'
import { nanoid } from 'nanoid'
import type {
  AgentSession,
  SessionStatus,
  KanbanColumn,
  ClientMessage,
  ServerMessage,
} from '@akari/shared-types'

const fastify = Fastify({ logger: { level: 'info' } })

await fastify.register(fastifyCors, { origin: true })
await fastify.register(fastifyWebsocket)

const clients = new Set<WebSocket>()

const sessions = new Map<string, AgentSession>()

function broadcast(message: ServerMessage) {
  const data = JSON.stringify(message)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  }
}

function pushToClient(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

function validateTransition(from: SessionStatus, to: SessionStatus): boolean {
  const allowed: Record<SessionStatus, SessionStatus[]> = {
    initializing: ['running', 'failed'],
    running: ['waiting', 'paused', 'completed', 'failed'],
    waiting: ['running', 'paused'],
    approved: ['running'],
    paused: ['running', 'failed'],
    review: ['completed', 'running'],
    completed: ['merged', 'archived'],
    failed: ['archived', 'running'],
    merged: ['archived'],
    archived: [],
  }
  return allowed[from]?.includes(to) ?? false
}

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

fastify.get('/sessions', async () => Array.from(sessions.values()))

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

  const id = nanoid(8)
  const session: AgentSession = {
    id,
    name: name.trim(),
    task: task.trim(),
    status: 'initializing',
    agentType,
    worktreePath: `.agent-worktrees/${id}`,
    branchName: `agent/${name.trim().replace(/[^a-zA-Z0-9-]/g, '-')}-${id}`,
    baseBranch,
    canvasPosition: { x: 100 + Math.random() * 600, y: 100 + Math.random() * 400 },
    canvasSize: { width: 280, height: 220 },
    kanbanColumn: 'backlog' as KanbanColumn,
    terminalId: nanoid(8),
    progress: 0,
    terminalOutput: [],
    diffSummary: '',
    createdAt: new Date(),
    tags,
  }

  sessions.set(id, session)
  broadcast({ event: 'session:created', payload: session })

  simulateSessionLifecycle(id)

  return reply.status(201).send(session)
})

fastify.patch<{ Params: { id: string }; Body: { status: SessionStatus } }>(
  '/sessions/:id/status',
  async (request, reply) => {
    const { id } = request.params
    const { status } = request.body
    const session = sessions.get(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    if (!validateTransition(session.status, status)) {
      return reply.status(422).send({ error: `invalid transition: ${session.status} → ${status}` })
    }
    session.status = status
    broadcast({ event: 'session:status', payload: { id, status, progress: session.progress } })
    return session
  }
)

fastify.post<{ Params: { id: string }; Body: { decision: 'approved' | 'rejected'; comment?: string } }>(
  '/sessions/:id/approval',
  async (request, reply) => {
    const { id } = request.params
    const { decision, comment } = request.body
    const session = sessions.get(id)
    if (!session) return reply.status(404).send({ error: 'session not found' })
    if (session.status !== 'waiting') {
      return reply.status(422).send({ error: 'session is not waiting for approval' })
    }
    session.pendingApproval = undefined
    if (decision === 'approved') {
      session.status = 'running'
      session.terminalOutput.push(`> ✅ Approved${comment ? ': ' + comment : ''}, resuming...`)
    } else {
      session.status = 'paused'
      session.terminalOutput.push(`> ❌ Rejected${comment ? ': ' + comment : ''}, paused`)
    }
    broadcast({ event: 'session:status', payload: { id, status: session.status, progress: session.progress } })
    return { ok: true }
  }
)

fastify.post<{ Body: { message: string; targets?: string[] } }>(
  '/broadcast',
  async (request) => {
    const { message, targets } = request.body
    const targetIds = targets ?? Array.from(sessions.keys())
    for (const id of targetIds) {
      const session = sessions.get(id)
      if (session && (session.status === 'running' || session.status === 'waiting')) {
        session.terminalOutput.push(`> 📢 Broadcast: ${message}`)
        broadcast({ event: 'terminal:data', payload: { sessionId: id, data: `\r\n📢 ${message}\r\n` } })
      }
    }
    return { ok: true, targets: targetIds }
  }
)

fastify.get('/ws', { websocket: true }, (socket) => {
  clients.add(socket)
  fastify.log.info(`WebSocket client connected (total: ${clients.size})`)

  pushToClient(socket, { event: 'sessions:list', payload: Array.from(sessions.values()) })

  socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage
      handleClientMessage(socket, msg)
    } catch {
      fastify.log.warn('Invalid WS message received')
    }
  })

  socket.on('close', () => {
    clients.delete(socket)
    fastify.log.info(`WebSocket client disconnected (total: ${clients.size})`)
  })
})

function handleClientMessage(ws: WebSocket, msg: ClientMessage) {
  switch (msg.event) {
    case 'terminal:input': {
      const { sessionId, data } = msg.payload
      const session = sessions.get(sessionId)
      if (session) {
        session.terminalOutput.push(`> ${data.trim()}`)
        broadcast({ event: 'terminal:data', payload: { sessionId, data } })
      }
      break
    }
    case 'approval:decision': {
      const { sessionId, decision, comment } = msg.payload
      const session = sessions.get(sessionId)
      if (session && session.status === 'waiting') {
        session.pendingApproval = undefined
        if (decision === 'approved') {
          session.status = 'running'
          session.terminalOutput.push(`> ✅ Approved${comment ? ': ' + comment : ''}, resuming...`)
        } else {
          session.status = 'paused'
          session.terminalOutput.push(`> ❌ Rejected${comment ? ': ' + comment : ''}, paused`)
        }
        broadcast({ event: 'session:status', payload: { id: sessionId, status: session.status, progress: session.progress } })
      }
      break
    }
    case 'broadcast:send': {
      const { message, targets } = msg.payload
      const targetIds = targets ?? Array.from(sessions.keys())
      for (const id of targetIds) {
        const session = sessions.get(id)
        if (session) {
          broadcast({ event: 'terminal:data', payload: { sessionId: id, data: `\r\n📢 ${message}\r\n` } })
        }
      }
      break
    }
  }
  void ws
}

function simulateSessionLifecycle(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  const steps = [
    { delay: 800, action: () => {
      session.terminalOutput.push('> Creating worktree...')
      broadcast({ event: 'terminal:data', payload: { sessionId, data: '> Creating worktree...\r\n' } })
    }},
    { delay: 1600, action: () => {
      session.terminalOutput.push(`> Setting up branch ${session.branchName}`)
      broadcast({ event: 'terminal:data', payload: { sessionId, data: `> Setting up branch ${session.branchName}\r\n` } })
    }},
    { delay: 2400, action: () => {
      session.status = 'running'
      session.kanbanColumn = 'in-progress'
      session.terminalOutput.push('> Agent started, working on task...')
      broadcast({ event: 'session:status', payload: { id: sessionId, status: 'running', progress: 0 } })
      broadcast({ event: 'terminal:data', payload: { sessionId, data: '> Agent started, working on task...\r\n' } })
    }},
    { delay: 4000, action: () => {
      session.progress = 30
      session.terminalOutput.push('[CHECKPOINT] Analyzed requirements, starting implementation')
      broadcast({ event: 'checkpoint:reached', payload: { sessionId, description: 'Analyzed requirements, starting implementation', timestamp: new Date().toISOString() } })
      broadcast({ event: 'session:status', payload: { id: sessionId, status: 'running', progress: 30 } })
    }},
    { delay: 6000, action: () => {
      session.progress = 60
      broadcast({ event: 'session:status', payload: { id: sessionId, status: 'running', progress: 60 } })
      broadcast({ event: 'terminal:data', payload: { sessionId, data: '> Progress: 60%\r\n' } })
    }},
  ]

  for (const step of steps) {
    setTimeout(step.action, step.delay)
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
