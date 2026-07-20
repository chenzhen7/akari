import type { FastifyInstance } from 'fastify'
import type { ClientMessage } from '@akari/shared-types'

export default async function websocketPlugin(fastify: FastifyInstance) {
  fastify.get('/ws', { websocket: true }, (socket) => {
    fastify.clients.add(socket)
    fastify.log.info(`WebSocket client connected (total: ${fastify.clients.size})`)

    // 连接建立时只发送全局工作区列表，具体工作区的初始化等客户端订阅后再发送
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() }))
    }

    socket.on('message', async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage
        await handleClientMessage(msg, socket, fastify)
      } catch {
        fastify.log.warn('Invalid WS message received')
      }
    })

    socket.on('close', () => {
      const workspaceId = fastify.workspaceClients.get(socket)
      if (workspaceId) {
        fastify.workspaceSessionRegistry.unsubscribeClient(socket, workspaceId)
      }
      fastify.clients.delete(socket)
      fastify.workspaceClients.delete(socket)
      fastify.log.info(`WebSocket client disconnected (total: ${fastify.clients.size})`)
    })
  })
}

async function handleClientMessage(msg: ClientMessage, socket: WebSocket, fastify: FastifyInstance): Promise<void> {
  if (msg.event === 'subscribe:workspace') {
    const { workspaceId } = msg.payload
    const previousWorkspaceId = fastify.workspaceClients.get(socket)
    if (previousWorkspaceId && previousWorkspaceId !== workspaceId) {
      fastify.workspaceSessionRegistry.unsubscribeClient(socket, previousWorkspaceId)
    }
    fastify.workspaceClients.set(socket, workspaceId)
    fastify.log.info(`WebSocket client subscribed to workspace ${workspaceId}`)

    const sessionManager = await fastify.workspaceSessionRegistry.subscribeClient(socket, workspaceId)
    const workspace = fastify.workspaceManager.getWorkspaceById(workspaceId)

    // Push initial workspace-specific state
    if (socket.readyState === WebSocket.OPEN) {
      if (workspace) {
        socket.send(JSON.stringify({ event: 'workspace:activated', payload: workspace }))
      }
      socket.send(JSON.stringify({ event: 'sessions:list', payload: sessionManager.listSessions() }))
      socket.send(JSON.stringify({ event: 'canvas:edges', payload: getCanvasEdgesForWorkspace(fastify, sessionManager) }))
    }

    return
  }

  const workspaceId = fastify.workspaceClients.get(socket)
  if (!workspaceId) {
    fastify.log.warn('WebSocket message received before workspace subscription')
    return
  }

  const sessionManager = await fastify.getOrCreateSessionManager(workspaceId)

  switch (msg.event) {
    case 'terminal:input': {
      const { terminalId, data } = msg.payload
      sessionManager.sendToTerminal(terminalId, data)
      break
    }
    case 'terminal:resize': {
      const { terminalId, cols, rows } = msg.payload
      sessionManager.resizeTerminal(terminalId, cols, rows)
      break
    }
    case 'broadcast:send': {
      const { message, targets } = msg.payload
      sessionManager.broadcastMessage_legacy(message, targets)
      break
    }
    case 'tab:create': {
      const { sessionId, type, filePath } = msg.payload
      try {
        sessionManager.createTab(sessionId, type, filePath)
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'tab:create failed')
      }
      break
    }
    case 'tab:close': {
      const { sessionId, tabId } = msg.payload
      sessionManager.closeTab(sessionId, tabId)
      break
    }
    case 'tab:activate': {
      const { sessionId, tabId } = msg.payload
      sessionManager.activateTab(sessionId, tabId)
      break
    }
    case 'tab:reorder': {
      const { sessionId, orderedTabIds } = msg.payload
      sessionManager.reorderTabs(sessionId, orderedTabIds)
      break
    }
    case 'terminal:create': {
      const { sessionId, agentType, bypassPermissions } = msg.payload
      try {
        sessionManager.createTab(
          sessionId,
          agentType && agentType !== 'shell' ? 'agent' : 'terminal',
          undefined,
          agentType,
          { bypassPermissions },
        )
      } catch (err) {
        fastify.log.warn({ err, sessionId, agentType }, 'terminal:create failed')
      }
      break
    }
  }
}

function getCanvasEdgesForWorkspace(fastify: FastifyInstance, sessionManager: import('../session-manager.js').SessionManager) {
  const edges = fastify.canvasEdgeStore.getAllEdges()
  const sessionIds = new Set(sessionManager.listSessions().map(s => s.id))
  return edges.filter(
    e => sessionIds.has(e.sourceSessionId) && sessionIds.has(e.targetSessionId),
  )
}
