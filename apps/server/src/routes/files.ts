import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function filesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/sessions/:id/files',
    async (request, reply) => {
      const { id } = request.params
      const { path: relativePath } = request.query
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const files = await request.sessionManager.listFiles(id, relativePath ?? '')
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
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const content = await request.sessionManager.readFileContent(id, filePath)
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
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.writeFileContent(id, filePath, content)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
