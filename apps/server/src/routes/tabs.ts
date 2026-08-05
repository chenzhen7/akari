import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function tabsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id/tabs',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      return request.sessionManager.getTabs(id)
    },
  )

  fastify.post<{ Params: { id: string }; Body: { type: 'terminal' | 'agent' | 'diff' | 'file' | 'review'; filePath?: string } }>(
    '/sessions/:id/tabs',
    async (request, reply) => {
      const { id } = request.params
      const { type, filePath } = request.body
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const tab = request.sessionManager.createTab(id, type, filePath)
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
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      request.sessionManager.closeTab(id, tabId)
      return { ok: true }
    },
  )

  fastify.patch<{ Params: { id: string; tabId: string } }>(
    '/sessions/:id/tabs/:tabId/activate',
    async (request, reply) => {
      const { id, tabId } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      request.sessionManager.activateTab(id, tabId)
      return { ok: true }
    },
  )
}
