import type { FastifyInstance } from 'fastify'

export default async function gitRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string; branch?: string } }>(
    '/sessions/:id/git-log',
    async (request, reply) => {
      const { id } = request.params
      const limit = parseInt(request.query.limit ?? '100') || 100
      const offset = parseInt(request.query.offset ?? '0') || 0
      const branch = request.query.branch
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      return fastify.sessionManager.getGitLog(id, limit, offset, branch)
    },
  )

  fastify.get<{ Params: { id: string } }>(
    '/sessions/:id/git-branches',
    async (request, reply) => {
      const { id } = request.params
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      return fastify.sessionManager.getGitBranches(id)
    },
  )

  fastify.post<{ Params: { id: string }; Body: { message: string } }>(
    '/sessions/:id/git/commit',
    async (request, reply) => {
      const { id } = request.params
      const { message } = request.body
      if (!message?.trim()) return reply.status(400).send({ error: 'message is required' })
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.commitAll(id, message.trim())
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
      const session = fastify.sessionManager.getSession(id)
      if (!session) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.worktreeMerge(id, sourceBranch.trim())
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.updateFromBase(id)
        return { ok: true }
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.checkoutBranch(id, branch.trim(), createNew)
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.discardAll(id)
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
      if (!fastify.sessionManager.getSession(id)) return reply.status(404).send({ error: 'session not found' })
      try {
        await fastify.sessionManager.discardFile(id, filePath.trim())
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(422).send({ error: msg })
      }
    },
  )
}
