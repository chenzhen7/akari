import type { SessionManager } from '../session-manager.js'

export interface WorkspaceSessionRegistryServiceOptions {
  getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
  sessionManagers: Map<string, SessionManager>
  onDispose?: (workspaceId: string) => void
}

/**
 * 单窗口模型下的 SessionManager 注册表。
 *
 * 职责：
 * 1. 按需创建/复用每个 workspace 的 SessionManager。
 * 2. 在应用退出或 workspace 被删除时统一 dispose。
 *
 * 注意：不再维护 WebSocket 客户端集合，也不再因为“没有订阅客户端”而自动回收 PTY。
 * 终端进程的生命周期与 SessionManager 绑定，只要服务端还在运行就保持存活。
 */
export class WorkspaceSessionRegistryService {
  private readonly getOrCreateSessionManager: (workspaceId: string) => Promise<SessionManager>
  private readonly sessionManagers: Map<string, SessionManager>
  private readonly onDispose?: (workspaceId: string) => void

  constructor(opts: WorkspaceSessionRegistryServiceOptions) {
    this.getOrCreateSessionManager = opts.getOrCreateSessionManager
    this.sessionManagers = opts.sessionManagers
    this.onDispose = opts.onDispose
  }

  /** 获取或创建指定 workspace 的 SessionManager。 */
  async getSessionManager(workspaceId: string): Promise<SessionManager> {
    return this.getOrCreateSessionManager(workspaceId)
  }

  /** 释放指定 workspace 的 SessionManager 及其下所有资源（PTY、watcher 等）。 */
  async disposeWorkspace(workspaceId: string): Promise<void> {
    const manager = this.sessionManagers.get(workspaceId)
    if (!manager || manager.isDisposed) {
      this.sessionManagers.delete(workspaceId)
      return
    }

    try {
      await manager.dispose()
    } catch (err: unknown) {
      console.error(`[WorkspaceSessionRegistryService] disposeWorkspace ${workspaceId} failed:`, err)
    } finally {
      this.sessionManagers.delete(workspaceId)
      this.onDispose?.(workspaceId)
    }
  }

  /** 应用退出时释放所有 SessionManager。 */
  async disposeAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [workspaceId, manager] of this.sessionManagers) {
      promises.push(
        manager.dispose().then(() => {
          this.sessionManagers.delete(workspaceId)
        }).catch((err: unknown) => {
          console.error(`[WorkspaceSessionRegistryService] disposeAll ${workspaceId} failed:`, err)
        })
      )
    }
    await Promise.all(promises)
  }
}
