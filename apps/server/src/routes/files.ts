import type { FastifyInstance, FastifyRequest } from 'fastify'
import { perfLog, perfNow } from '../perf-log.js'

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
        const t0 = perfNow()
        const content = await request.sessionManager.readFileContent(id, filePath)
        perfLog(`[route] file-content ${filePath}（handler 总耗时）`, t0)
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

  fastify.post<{ Params: { id: string }; Body: { path: string } }>(
    '/sessions/:id/directory',
    async (request, reply) => {
      const { id } = request.params
      const { path: dirPath } = request.body
      if (!dirPath) return reply.status(400).send({ error: 'path is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.createDirectory(id, dirPath)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, dirPath }, 'createDirectory failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { path: string } }>(
    '/sessions/:id/file',
    async (request, reply) => {
      const { id } = request.params
      const { path: filePath } = request.body
      if (!filePath) return reply.status(400).send({ error: 'path is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.createFile(id, filePath)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, filePath }, 'createFile failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { from: string; to: string } }>(
    '/sessions/:id/rename',
    async (request, reply) => {
      const { id } = request.params
      const { from, to } = request.body
      if (!from || !to) return reply.status(400).send({ error: 'from and to are required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.renamePath(id, from, to)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, from, to }, 'renamePath failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { path: string } }>(
    '/sessions/:id/delete',
    async (request, reply) => {
      const { id } = request.params
      const { path: targetPath } = request.body
      if (!targetPath) return reply.status(400).send({ error: 'path is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.deletePath(id, targetPath)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, targetPath }, 'deletePath failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { source: string; targetDir: string } }>(
    '/sessions/:id/copy',
    async (request, reply) => {
      const { id } = request.params
      const { source, targetDir } = request.body ?? {}
      if (!source || typeof targetDir !== 'string') return reply.status(400).send({ error: 'source and targetDir are required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const path = await request.sessionManager.copyPath(id, source, targetDir)
        return { path }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, source, targetDir }, 'copyPath failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { source: string; targetDir: string } }>(
    '/sessions/:id/move',
    async (request, reply) => {
      const { id } = request.params
      const { source, targetDir } = request.body ?? {}
      if (!source || typeof targetDir !== 'string') return reply.status(400).send({ error: 'source and targetDir are required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const path = await request.sessionManager.movePath(id, source, targetDir)
        return { path }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, source, targetDir }, 'movePath failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
