import type { FastifyInstance } from 'fastify'
import type { ClientMessage, ServerMessage } from '@akari/shared-types'

export default async function websocketPlugin(fastify: FastifyInstance) {
  fastify.get('/ws', { websocket: true }, (socket) => {
    fastify.clients.add(socket)
    fastify.log.info(`WebSocket client connected (total: ${fastify.clients.size})`)

    if (socket.readyState === WebSocket.OPEN) {
      const currentWs = fastify.workspaceManager.getCurrentWorkspace()
      if (currentWs) {
        socket.send(JSON.stringify({ event: 'workspace:current', payload: currentWs }))
      }
      socket.send(JSON.stringify({ event: 'workspace:list', payload: fastify.workspaceManager.listWorkspaces() }))
      socket.send(JSON.stringify({ event: 'sessions:list', payload: fastify.sessionManager.listSessions() }))
      socket.send(JSON.stringify({ event: 'canvas:edges', payload: fastify.canvasEdgeStore.getAllEdges() }))
    }

    // Push current diffs to the newly connected client so DiffViewer restores after refresh
    void (async () => {
      const sessions = fastify.sessionManager.listSessions()
      const active = sessions.filter(s => s.worktreePath && !['archived', 'initializing', 'failed'].includes(s.status))
      for (const session of active) {
        try {
          const diff = await fastify.sessionManager.getCurrentDiff(session.id)
          if (diff.files.length > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              event: 'diff:update',
              payload: { sessionId: session.id, diff },
            } satisfies ServerMessage))
          }
        } catch {
          // ignore individual failures
        }
      }
    })()

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage
        handleClientMessage(msg, fastify)
      } catch {
        fastify.log.warn('Invalid WS message received')
      }
    })

    socket.on('close', () => {
      fastify.clients.delete(socket)
      fastify.log.info(`WebSocket client disconnected (total: ${fastify.clients.size})`)
    })
  })
}

function handleClientMessage(msg: ClientMessage, fastify: FastifyInstance): void {
  switch (msg.event) {
    case 'terminal:input': {
      const { terminalId, data } = msg.payload
      fastify.sessionManager.sendToTerminal(terminalId, data)
      break
    }
    case 'terminal:resize': {
      const { terminalId, cols, rows } = msg.payload
      fastify.sessionManager.resizeTerminal(terminalId, cols, rows)
      break
    }
    case 'broadcast:send': {
      const { message, targets } = msg.payload
      fastify.sessionManager.broadcastMessage_legacy(message, targets)
      break
    }
    case 'tab:create': {
      const { sessionId, type, filePath } = msg.payload
      try {
        fastify.sessionManager.createTab(sessionId, type, filePath)
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'tab:create failed')
      }
      break
    }
    case 'tab:close': {
      const { sessionId, tabId } = msg.payload
      fastify.sessionManager.closeTab(sessionId, tabId)
      break
    }
    case 'tab:activate': {
      const { sessionId, tabId } = msg.payload
      fastify.sessionManager.activateTab(sessionId, tabId)
      break
    }
    case 'tab:reorder': {
      const { sessionId, orderedTabIds } = msg.payload
      fastify.sessionManager.reorderTabs(sessionId, orderedTabIds)
      break
    }
    case 'terminal:create': {
      const { sessionId, agentType, bypassPermissions } = msg.payload
      try {
        fastify.sessionManager.createTab(
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
