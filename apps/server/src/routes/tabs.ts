import type { FastifyInstance } from 'fastify'

export default async function tabsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id/tabs',
    async (request, reply) => {
      const { id } = request.params
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      return fastify.sessionManager.getTabs(id)
    },
  )

  fastify.post<{ Params: { id: string }; Body: { type: 'terminal' | 'agent' | 'diff'; filePath?: string } }>(
    '/sessions/:id/tabs',
    async (request, reply) => {
      const { id } = request.params
      const { type, filePath } = request.body
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const tab = fastify.sessionManager.createTab(id, type, filePath)
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      fastify.sessionManager.closeTab(id, tabId)
      return { ok: true }
    },
  )

  fastify.patch<{ Params: { id: string; tabId: string } }>(
    '/sessions/:id/tabs/:tabId/activate',
    async (request, reply) => {
      const { id, tabId } = request.params
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      fastify.sessionManager.activateTab(id, tabId)
      return { ok: true }
    },
  )
}
