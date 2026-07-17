import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get('/settings', async (request: FastifyRequest) => request.sessionManager.getSettings())

  fastify.patch<{ Body: { worktreeBaseDir?: string } }>('/settings', async (request, reply) => {
    const { worktreeBaseDir } = request.body
    if (worktreeBaseDir !== undefined && typeof worktreeBaseDir !== 'string') {
      return reply.status(400).send({ error: 'worktreeBaseDir must be a string' })
    }
    if (worktreeBaseDir) {
      request.sessionManager.updateSettings({ worktreeBaseDir })
    }
    return request.sessionManager.getSettings()
  })
}
