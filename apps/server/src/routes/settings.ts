import type { FastifyInstance } from 'fastify'
import { SettingsStore } from '../infrastructure/db/settings-store.js'

export default async function settingsRoutes(fastify: FastifyInstance) {
  const settingsStore = new SettingsStore(fastify.db)

  fastify.get('/settings', async () => {
    return { worktreeBaseDir: settingsStore.getWorktreeBaseDir() }
  })

  fastify.patch<{ Body: { worktreeBaseDir?: string } }>('/settings', async (request, reply) => {
    const { worktreeBaseDir } = request.body
    if (worktreeBaseDir !== undefined && typeof worktreeBaseDir !== 'string') {
      return reply.status(400).send({ error: 'worktreeBaseDir must be a string' })
    }
    if (worktreeBaseDir) {
      settingsStore.setWorktreeBaseDir(worktreeBaseDir)
    }
    return { worktreeBaseDir: settingsStore.getWorktreeBaseDir() }
  })
}
