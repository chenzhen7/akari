import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { HookEvent } from '@akari/shared-types'
import { dispatchHookEvent } from '../hook-dispatcher.js'

export default async function hooksRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string }; Body: HookEvent }>(
    '/sessions/:id/hooks',
    async (request, reply) => {
      const { id } = request.params
      const event = request.body
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const response = await dispatchHookEvent(id, event, request.sessionManager)
        return response
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.error(`[hooks] dispatchHookEvent error for ${id}: ${msg}`)
        return reply.status(500).send({ error: msg })
      }
    },
  )

  fastify.post<{ Body: { message: string; targets?: string[] } }>(
    '/broadcast',
    async (request) => {
      const { message, targets } = request.body
      const targetIds = request.sessionManager.broadcastMessage_legacy(message, targets)
      return { ok: true, targets: targetIds }
    },
  )
}
