import { execa } from 'execa'
import { join } from 'node:path'
import { access, constants, writeFile } from 'node:fs/promises'
import { getGitRoot } from '../infrastructure/git/git-utils.js'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/** git init 时仅在不存在的情况下创建的 .gitignore 内容（node_modules / .agent-worktrees 是 Akari 工作流的两大污染源）。 */
const GITIGNORE_CONTENT = ['node_modules/', '.agent-worktrees/', ''].join('\n')

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
    // 激活时重探测 git 状态（覆盖外部 git init / 仓库移除后的 DB 过期），并同步运行时 SessionManager
    const synced = await fastify.syncWorkspaceGitState(workspace)
    fastify.broadcast({ event: 'workspace:activated', payload: synced }, workspace.id)
    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    return { ok: true }
  })

  /**
   * 在项目内直接初始化 Git 仓库（仅 git init，不自动提交）。
   * 幂等：已是仓库时 git init 无副作用；已存在 .gitignore 时不覆盖。
   * 成功后同步 DB 仓库状态 + 运行时 SessionManager 的 git 能力。
   */
  fastify.post<{ Params: { id: string } }>('/workspaces/:id/git-init', async (request, reply) => {
    const { id } = request.params
    const workspace = fastify.workspaceManager.getWorkspaceById(id)
    if (!workspace) return reply.status(404).send({ error: 'workspace not found' })

    await execa('git', ['init'], { cwd: workspace.path })

    // 仅在不存在时创建 .gitignore；写失败不影响已成功的 git init，记 warn 继续
    const gitignorePath = join(workspace.path, '.gitignore')
    await access(gitignorePath, constants.F_OK).catch(async () => {
      await writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf8').catch((err: unknown) => {
        fastify.log.warn({ err, workspaceId: id }, 'git-init: failed to write .gitignore, continuing')
      })
    })

    // 重探测 git 根并更新 DB
    const gitRoot = await getGitRoot(workspace.path)
    const repoRoot = gitRoot ?? workspace.path
    const updated = fastify.workspaceManager.updateGitState(id, repoRoot, gitRoot !== null)
    if (!updated) return reply.status(404).send({ error: 'workspace not found' })

    // 同步运行时状态：翻转 isGitWorkspace + 主会话 git 接线（manager 未创建时会以新状态创建）
    const manager = await fastify.getOrCreateSessionManager(id)
    await manager.enableGitWorkspace(repoRoot)

    fastify.broadcast({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() })
    fastify.broadcast({ event: 'workspace:activated', payload: updated }, id)
    return updated
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
