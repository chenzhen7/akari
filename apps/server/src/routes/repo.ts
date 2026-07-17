import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function repoRoutes(fastify: FastifyInstance) {
  fastify.get('/repo/branches', async (request: FastifyRequest) => request.sessionManager.getRepoBranches())
}
