import type { FastifyInstance } from 'fastify'

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get('/settings', async () => fastify.sessionManager.getSettings())

  fastify.patch<{ Body: { worktreeBaseDir?: string } }>('/settings', async (request, reply) => {
    const { worktreeBaseDir } = request.body
    if (worktreeBaseDir !== undefined && typeof worktreeBaseDir !== 'string') {
      return reply.status(400).send({ error: 'worktreeBaseDir must be a string' })
    }
    if (worktreeBaseDir) {
      fastify.sessionManager.updateSettings({ worktreeBaseDir })
    }
    return fastify.sessionManager.getSettings()
  })
}
