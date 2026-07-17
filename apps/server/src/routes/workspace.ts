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

  fastify.post<{ Params: { id: string } }>('/workspaces/:id/switch', async (request, reply) => {
    const { id } = request.params
    const workspace = fastify.workspaceManager.switchWorkspace(id)
    if (!workspace) return reply.status(404).send({ error: 'workspace not found' })
    await request.sessionManager.setWorkspace(workspace.id, workspace.path, workspace.repoRoot, workspace.isGit)
    await request.sessionManager.restoreSessions()
    fastify.broadcast({ event: 'workspace:current', payload: workspace })
    await request.sessionManager.ensureMainSession(workspace.path)
    fastify.broadcast({ event: 'sessions:list', payload: request.sessionManager.listSessions() })
    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return { ok: true }
  })

  fastify.delete<{ Params: { id: string } }>('/workspaces/:id', async (request, reply) => {
    const { id } = request.params
    const deleted = fastify.workspaceManager.deleteWorkspace(id)
    if (!deleted) return reply.status(404).send({ error: 'workspace not found' })
    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return { ok: true }
  })
}
