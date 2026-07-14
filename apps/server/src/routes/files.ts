import type { FastifyInstance } from 'fastify'

export default async function filesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/sessions/:id/files',
    async (request, reply) => {
      const { id } = request.params
      const { path: relativePath } = request.query
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const files = await fastify.sessionManager.listFiles(id, relativePath ?? '')
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const content = await fastify.sessionManager.readFileContent(id, filePath)
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.writeFileContent(id, filePath, content)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
