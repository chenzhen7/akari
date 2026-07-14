import type { FastifyInstance } from 'fastify'

export default async function canvasRoutes(fastify: FastifyInstance) {
  fastify.get('/canvas/edges', async () => fastify.canvasEdgeStore.getAllEdges())

  fastify.post<{
    Body: { sourceSessionId: string; targetSessionId: string; trigger?: 'on-complete'; injectContext?: boolean }
  }>(
    '/canvas/edges',
    async (request, reply) => {
      const { sourceSessionId, targetSessionId } = request.body
      if (!sourceSessionId || !targetSessionId) {
        return reply.status(400).send({ error: 'sourceSessionId and targetSessionId are required' })
      }
      const edge = fastify.canvasEdgeStore.createEdge(request.body)
      fastify.broadcast({ event: 'canvas:edges', payload: fastify.canvasEdgeStore.getAllEdges() })
      return reply.status(201).send(edge)
    },
  )

  fastify.delete<{ Params: { edgeId: string } }>(
    '/canvas/edges/:edgeId',
    async (request, reply) => {
      const { edgeId } = request.params
      const deleted = fastify.canvasEdgeStore.deleteEdge(edgeId)
      if (!deleted) return reply.status(404).send({ error: 'edge not found' })
      fastify.broadcast({ event: 'canvas:edges', payload: fastify.canvasEdgeStore.getAllEdges() })
      return { ok: true }
    },
  )
}
