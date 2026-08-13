import type { FastifyInstance } from 'fastify'
import type { ClientMessage } from '@akari/shared-types'

export default async function websocketPlugin(fastify: FastifyInstance) {
  fastify.get('/ws', { websocket: true }, (socket) => {
    const wsState = fastify.wsState
    wsState.socket = socket
    fastify.log.info('WebSocket client connected')

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
      // 单窗口模型：当前连接关闭时清空状态，但不 dispose SessionManager。
      // 终端进程保持运行，等待客户端重连或下次启动。
      if (wsState.socket === socket) {
        wsState.socket = null
        wsState.workspaceId = null
      }
      fastify.log.info('WebSocket client disconnected')
    })
  })
}

async function handleClientMessage(msg: ClientMessage, socket: WebSocket, fastify: FastifyInstance): Promise<void> {
  const wsState = fastify.wsState

  if (msg.event === 'subscribe:workspace') {
    const { workspaceId } = msg.payload
    wsState.workspaceId = workspaceId
    fastify.log.info(`WebSocket client subscribed to workspace ${workspaceId}`)

    const sessionManager = await fastify.getOrCreateSessionManager(workspaceId)
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

  const workspaceId = wsState.workspaceId
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
      const { sessionId, type, filePath, commitHash } = msg.payload
      try {
        sessionManager.createTab(sessionId, type, filePath, undefined, undefined, commitHash)
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
