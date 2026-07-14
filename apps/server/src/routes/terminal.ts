import type { FastifyInstance } from 'fastify'

export default async function terminalRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { terminalId?: string } }>(
    '/sessions/:id/terminal-buffer',
    async (request, reply) => {
      const { id } = request.params
      const { terminalId } = request.query
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      if (!terminalId) return reply.status(400).send({ error: 'terminalId query param is required' })
      return { buffer: fastify.sessionManager.getTerminalBuffer(terminalId) }
    },
  )
}
