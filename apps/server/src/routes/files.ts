import type { FastifyInstance, FastifyRequest } from 'fastify'
import { perfLog, perfNow } from '../perf-log.js'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

/** 按扩展名返回 MIME，未知类型回退到二进制流 */
function mimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_MIME[ext] ?? 'application/octet-stream'
}

/** 外部文件粘贴上传单文件大小上限 */
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024

export default async function filesRoutes(fastify: FastifyInstance) {
  // 粘贴上传使用原始二进制 body（非 JSON），需为 application/octet-stream 注册 buffer parser
  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: UPLOAD_MAX_BYTES },
    (_request, body, done) => {
      done(null, body)
    },
  )

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

  // 二进制原始文件（markdown 预览的相对图片等）。路径经 assertPathInWorktree 校验防穿越。
  fastify.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/sessions/:id/raw-file',
    async (request, reply) => {
      const { id } = request.params
      const { path: filePath } = request.query
      if (!filePath) return reply.status(400).send({ error: 'path query param is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const data = await request.sessionManager.readRawFile(id, filePath)
        return reply.type(mimeForPath(filePath)).send(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, filePath }, 'readRawFile failed')
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

  // 外部文件粘贴上传：query 传 targetDir / name，body 为原始二进制（application/octet-stream）
  fastify.post<{ Params: { id: string }; Querystring: { targetDir?: string; name?: string } }>(
    '/sessions/:id/upload-file',
    async (request, reply) => {
      const { id } = request.params
      const { targetDir = '', name } = request.query
      if (!name) return reply.status(400).send({ error: 'name query param is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      const body = request.body
      if (!(body instanceof Buffer)) {
        return reply.status(400).send({ error: 'expected application/octet-stream body' })
      }
      try {
        const path = await request.sessionManager.uploadFile(id, targetDir, name, body)
        return { path }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        fastify.log.warn({ err: msg, sessionId: id, targetDir, name }, 'uploadFile failed')
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
