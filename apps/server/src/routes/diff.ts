import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function diffRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/diff-refresh',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      request.sessionManager.refreshDiff(id)
      return { ok: true }
    },
  )

  fastify.get<{ Params: { id: string }; Querystring: { file?: string } }>(
    '/sessions/:id/diff-content',
    async (request, reply) => {
      const { id } = request.params
      const { file } = request.query
      if (!file) return reply.status(400).send({ error: 'file query param is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const content = await request.sessionManager.getFileDiffContent(id, file)
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
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const lines = await request.sessionManager.getFileDiffLines(id, filePath)
        return { lines }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id }, 'getFileDiffLines failed')
        return { lines: [] }
      }
    },
  )
}
