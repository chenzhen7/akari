import type { FastifyInstance, FastifyRequest } from 'fastify'

export default async function workspaceRoutes(fastify: FastifyInstance) {
  fastify.get('/workspaces', async () => fastify.workspaceManager.listWorkspaces())

  fastify.get<{ Params: { id: string } }>('/workspaces/:id', async (request, reply) => {
    const workspace = fastify.workspaceManager.getWorkspaceById(request.params.id)
    if (!workspace) return reply.status(404).send({ error: 'workspace not found' })
    return workspace
  })

  fastify.post<{ Body: { name: string; path: string } }>('/workspaces', async (request, reply) => {
    const { name, path } = request.body
    if (!name?.trim() || !path?.trim()) {
      return reply.status(400).send({ error: 'name and path are required' })
    }
    const validation = await fastify.workspaceManager.validatePath(path.trim())
    if (!validation.valid) {
      return reply.status(400).send({ error: validation.error })
    }
    const workspace = await fastify.workspaceManager.addWorkspace(name.trim(), path.trim())
    if (!workspace) {
      return reply.status(409).send({ error: 'workspace with this path already exists' })
    }
    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return reply.status(201).send(workspace)
  })

  fastify.post<{ Params: { id: string } }>('/workspaces/:id/activate', async (request, reply) => {
    const { id } = request.params
    const workspace = fastify.workspaceManager.activateWorkspace(id)
    if (!workspace) return reply.status(404).send({ error: 'workspace not found' })
    fastify.broadcast({ event: 'workspace:activated', payload: workspace }, workspace.id)
    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return { ok: true }
  })

  fastify.delete<{ Params: { id: string } }>('/workspaces/:id', async (request, reply) => {
    const { id } = request.params

    // 先检查该工作区是否已有 SessionManager 及其会话状态
    const sessionManager = await fastify.getOrCreateSessionManager(id).catch(() => null)
    if (sessionManager) {
      const activeSessions = sessionManager.listSessions().filter(s =>
        ['running', 'waiting'].includes(s.status)
      )
      if (activeSessions.length > 0) {
        return reply.status(409).send({
          error: 'workspace has active sessions',
          sessionIds: activeSessions.map(s => s.id),
        })
      }
    }

    const deleted = fastify.workspaceManager.deleteWorkspace(id)
    if (!deleted) return reply.status(404).send({ error: 'workspace not found' })

    // 删除成功后释放该工作区的 SessionManager 及其资源
    await fastify.workspaceSessionRegistry.disposeWorkspace(id)

    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return { ok: true }
  })

  fastify.patch<{ Params: { id: string }; Body: { pinned?: boolean } }>('/workspaces/:id/pin', async (request, reply) => {
    const { id } = request.params
    const pinned = request.body.pinned ?? true
    const workspace = fastify.workspaceManager.pinWorkspace(id, pinned)
    if (!workspace) return reply.status(404).send({ error: 'workspace not found' })
    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return workspace
  })
}
