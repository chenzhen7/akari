import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function gitRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; branch?: string } }>(
    '/sessions/:id/git-log',
    async (request, reply) => {
      const { id } = request.params
      const limit = parseInt(request.query.limit ?? '100') || 100
      const offset = parseInt(request.query.offset ?? '0') || 0
      const branch = request.query.branch
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      return request.sessionManager.getGitLog(id, limit, offset, branch)
    },
  )

  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id/git-branches',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      return request.sessionManager.getGitBranches(id)
    },
  )

  fastify.post<{ Params: { id: string }; Body: { message: string; scope?: 'all' | 'viewed'; filePaths?: string[] } }>(
    '/sessions/:id/git/commit',
    async (request, reply) => {
      const { id } = request.params
      const { message, scope = 'all', filePaths } = request.body
      if (!message?.trim()) return reply.status(400).send({ error: 'message is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        if (scope === 'viewed') {
          if (!filePaths || filePaths.length === 0) {
            return reply.status(400).send({ error: 'no viewed files to commit' })
          }
          await request.sessionManager.commitFiles(id, message.trim(), filePaths)
        } else {
          await request.sessionManager.commitAll(id, message.trim())
        }
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { sourceBranch: string } }>(
    '/sessions/:id/git/merge',
    async (request, reply) => {
      const { id } = request.params
      const { sourceBranch } = request.body
      if (!sourceBranch?.trim()) return reply.status(400).send({ error: 'sourceBranch is required' })
      const session = request.sessionManager.getSession(id)
      if (!session) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.worktreeMerge(id, sourceBranch.trim())
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/git/update-branch',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.updateFromBase(id)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/git/pull',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.pullMain(id)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/git/push',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        const { upToDate } = await request.sessionManager.pushMain(id)
        return { ok: true, upToDate }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { branch: string; createNew?: boolean } }>(
    '/sessions/:id/git/checkout',
    async (request, reply) => {
      const { id } = request.params
      const { branch, createNew = false } = request.body
      if (!branch?.trim()) return reply.status(400).send({ error: 'branch is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.checkoutBranch(id, branch.trim(), createNew)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string } }>(
    '/sessions/:id/git/discard',
    async (request, reply) => {
      const { id } = request.params
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.discardAll(id)
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )

  fastify.post<{ Params: { id: string }; Body: { filePath: string } }>(
    '/sessions/:id/git/discard-file',
    async (request, reply) => {
      const { id } = request.params
      const { filePath } = request.body
      if (!filePath?.trim()) return reply.status(400).send({ error: 'filePath is required' })
      if (!request.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await request.sessionManager.discardFile(id, filePath.trim())
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
