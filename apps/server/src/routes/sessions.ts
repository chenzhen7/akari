import type { FastifyInstance } from 'fastify'
import type { AgentType, SessionStatus } from '@akari/shared-types'

export default async function sessionsRoutes(fastify: FastifyInstance) {
  fastify.get('/sessions', async () => fastify.sessionManager.listSessions())

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
      const session = await fastify.sessionManager.createSession({ name, task, baseBranch, agentType, tags, canvasPosition })
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
      const session = fastify.sessionManager.getSession(id)
      if (!session) return reply.status(404).send({ error: 'session not found' })
      const { validateTransition } = await import('../session-manager.js')
      if (!validateTransition(session.status, status)) {
        return reply.status(422).send({ error: `invalid transition: ${session.status} → ${status}` })
      }
      fastify.sessionManager.updateStatus(id, status)
      return fastify.sessionManager.getSession(id)
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/archive',
    async (request, reply) => {
      const { id } = request.params
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        fastify.sessionManager.archiveSession(id)
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        fastify.sessionManager.restoreSession(id)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.patch<{ Params: { id: string }; Body: { x: number; y: number } }>(
    '/sessions/:id/canvas',
    async (request, reply) => {
      const { id } = request.params
      const { x, y } = request.body
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      fastify.sessionManager.updateCanvasPosition(id, x, y)
      return { ok: true }
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    async (request, reply) => {
      const { id } = request.params
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.deleteSession(id)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
