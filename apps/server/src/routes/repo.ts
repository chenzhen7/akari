import type { FastifyInstance } from 'fastify'

export default async function repoRoutes(fastify: FastifyInstance) {
  fastify.get('/repo/branches', async () => fastify.sessionManager.getRepoBranches())
}
