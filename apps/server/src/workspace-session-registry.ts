import type { SessionManager } from './session-manager.js'

export interface WorkspaceSessionRegistryOptions {
  getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
  sessionManagers: Map<string, SessionManager>
  ttlMs?: number
  onDispose?: (workspaceId: string) => void
}

export class WorkspaceSessionRegistry {
  private readonly getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
  private readonly sessionManagers: Map<string, SessionManager>
  private readonly ttlMs: number
  private readonly onDispose?: (workspaceId: string) => void

  /** workspaceId -> set of subscribed WebSocket clients */
  private readonly clients = new Map<string, Set<WebSocket>>()

  /** workspaceId -> scheduled disposal timer */
  private readonly disposalTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(opts: WorkspaceSessionRegistryOptions) {
    this.getOrCreateSessionManager = opts.getOrCreateSessionManager
    this.sessionManagers = opts.sessionManagers
    this.ttlMs = opts.ttlMs ?? 30000
    this.onDispose = opts.onDispose
  }

  /** Track a WebSocket client for a workspace and ensure its SessionManager exists. */
  async subscribeClient(socket: WebSocket, workspaceId: string): Promise<SessionManager> {
    this.cancelDisposal(workspaceId)

    let set = this.clients.get(workspaceId)
    if (!set) {
      set = new Set()
      this.clients.set(workspaceId, set)
    }
    set.add(socket)

    return this.getOrCreateSessionManager(workspaceId)
  }

  /** Remove a client from a specific workspace. */
  unsubscribeClient(socket: WebSocket, workspaceId: string): void {
    const set = this.clients.get(workspaceId)
    if (!set) return

    set.delete(socket)
    if (set.size === 0) {
      this.clients.delete(workspaceId)
      this.scheduleDisposal(workspaceId)
    }
  }

  /** Remove a client from whichever workspace it is subscribed to. */
  removeClient(socket: WebSocket): void {
    for (const [workspaceId, set] of this.clients) {
      if (set.has(socket)) {
        this.unsubscribeClient(socket, workspaceId)
        return
      }
    }
  }

  /** Dispose all active SessionManagers immediately. Used on graceful shutdown. */
  async disposeAll(): Promise<void> {
    for (const timer of this.disposalTimers.values()) {
      clearTimeout(timer)
    }
    this.disposalTimers.clear()

    const promises: Promise<void>[] = []
    for (const [workspaceId, manager] of this.sessionManagers) {
      promises.push(
        manager.dispose().then(() => {
          this.sessionManagers.delete(workspaceId)
        }).catch((err: unknown) => {
          console.error(`[WorkspaceSessionRegistry] dispose ${workspaceId} failed:`, err)
        })
      )
    }
    await Promise.all(promises)
    this.clients.clear()
  }

  getClientCount(workspaceId: string): number {
    return this.clients.get(workspaceId)?.size ?? 0
  }

  private scheduleDisposal(workspaceId: string): void {
    this.cancelDisposal(workspaceId)

    const timer = setTimeout(() => {
      this.disposalTimers.delete(workspaceId)
      const manager = this.sessionManagers.get(workspaceId)
      if (!manager || manager.isDisposed) {
        this.sessionManagers.delete(workspaceId)
        return
      }

      manager.dispose().then(() => {
        this.sessionManagers.delete(workspaceId)
        this.onDispose?.(workspaceId)
      }).catch((err: unknown) => {
        console.error(`[WorkspaceSessionRegistry] scheduled dispose ${workspaceId} failed:`, err)
      })
    }, this.ttlMs)

    this.disposalTimers.set(workspaceId, timer)
  }

  private cancelDisposal(workspaceId: string): void {
    const timer = this.disposalTimers.get(workspaceId)
    if (timer) {
      clearTimeout(timer)
      this.disposalTimers.delete(workspaceId)
    }
  }
}
