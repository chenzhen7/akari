import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function canvasRoutes(fastify: FastifyInstance) {
  fastify.get('/canvas/edges', async (request: FastifyRequest) => {
    const edges = fastify.canvasEdgeStore.getAllEdges()
    const sessionIds = new Set(request.sessionManager.listSessions().map(s => s.id))
    return edges.filter(
      e => sessionIds.has(e.sourceSessionId) && sessionIds.has(e.targetSessionId),
    )
  })

  fastify.post<{
    Body: { sourceSessionId: string; targetSessionId: string; trigger?: 'on-complete'; injectContext?: boolean }
  }>(
    '/canvas/edges',
    async (request, reply) => {
      const { sourceSessionId, targetSessionId } = request.body
      if (!sourceSessionId || !targetSessionId) {
        return reply.status(400).send({ error: 'sourceSessionId and targetSessionId are required' })
      }
      if (!request.sessionManager.getSession(sourceSessionId) || !request.sessionManager.getSession(targetSessionId)) {
        return reply.status(404).send({ error: 'session not found' })
      }
      const edge = fastify.canvasEdgeStore.createEdge(request.body)
      const sessionIds = new Set(request.sessionManager.listSessions().map(s => s.id))
      fastify.broadcast(
        {
          event: 'canvas:edges',
          payload: fastify.canvasEdgeStore.getAllEdges().filter(
            e => sessionIds.has(e.sourceSessionId) && sessionIds.has(e.targetSessionId),
          ),
        },
        request.workspaceId,
      )
      return reply.status(201).send(edge)
    },
  )

  fastify.delete<{ Params: { edgeId: string } }>(
    '/canvas/edges/:edgeId',
    async (request, reply) => {
      const { edgeId } = request.params
      const edge = fastify.canvasEdgeStore.getAllEdges().find(e => e.id === edgeId)
      if (edge && (!request.sessionManager.getSession(edge.sourceSessionId) || !request.sessionManager.getSession(edge.targetSessionId))) {
        return reply.status(404).send({ error: 'edge not found' })
      }
      const deleted = fastify.canvasEdgeStore.deleteEdge(edgeId)
      if (!deleted) return reply.status(404).send({ error: 'edge not found' })
      const sessionIds = new Set(request.sessionManager.listSessions().map(s => s.id))
      fastify.broadcast(
        {
          event: 'canvas:edges',
          payload: fastify.canvasEdgeStore.getAllEdges().filter(
            e => sessionIds.has(e.sourceSessionId) && sessionIds.has(e.targetSessionId),
          ),
        },
        request.workspaceId,
      )
      return { ok: true }
    },
  )
}
