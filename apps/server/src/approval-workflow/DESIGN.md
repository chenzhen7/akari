# ApprovalWorkflow 模块设计

> 对应功能模块 **F5（审批工作流）**，前置依赖 F3（TerminalMux）+ F4（WorktreeManager）。  
> 文件位置：`apps/server/src/approval-workflow.ts`

## 职责

- 接收 TerminalMultiplexer 的 `approval:required` 事件
- 挂起 Agent（暂停终端输入），更新会话状态为 `waiting`
- 将审批请求 + 当前 Diff 推送给前端
- 等待前端用户决策，恢复或终止 Agent
- 支持批量审批

## 实现代码

```typescript
// apps/server/src/approval-workflow.ts
import type { SessionManager } from './session-manager';
import type { TerminalMultiplexer } from './terminal-mux';
import type { WorktreeManager } from './worktree-manager';
import type { WsServer } from './ws-server';

interface PendingApproval {
  type: string;
  command?: string;
  message: string;
  resolve: (decision: 'approved' | 'rejected') => void;
}

export class ApprovalWorkflow {
  private pending = new Map<string, PendingApproval>();

  constructor(
    private sessionManager: SessionManager,
    private terminalMux:    TerminalMultiplexer,
    private worktreeManager: WorktreeManager,
    private wsServer:        WsServer,
    private timeoutMs = 0,   // 0 = 不超时
  ) {}

  async requestApproval(sessionId: string, req: { type: string; command?: string; message: string }) {
    await this.sessionManager.updateStatus(sessionId, 'waiting');

    const diff = await this.worktreeManager.getDiff(sessionId);
    this.wsServer.broadcast('approval:required', { sessionId, request: req, diff });

    return new Promise<'approved' | 'rejected'>((resolve) => {
      this.pending.set(sessionId, { ...req, resolve });

      if (this.timeoutMs > 0) {
        setTimeout(() => {
          if (this.pending.has(sessionId)) {
            this.handleApproval(sessionId, 'rejected');  // 超时自动拒绝
          }
        }, this.timeoutMs);
      }
    });
  }

  async handleApproval(sessionId: string, decision: 'approved' | 'rejected') {
    const item = this.pending.get(sessionId);
    if (!item) return;

    if (decision === 'approved') {
      this.terminalMux.sendToTerminal(sessionId, 'y\n');
      await this.sessionManager.updateStatus(sessionId, 'running');
    } else {
      this.terminalMux.sendToTerminal(sessionId, 'n\n');
      await this.sessionManager.updateStatus(sessionId, 'paused');
    }

    item.resolve(decision);
    this.pending.delete(sessionId);
  }

  async batchApprove(sessionIds: string[]) {
    await Promise.all(sessionIds.map(id => this.handleApproval(id, 'approved')));
  }

  getPendingCount(): number {
    return this.pending.size;
  }
}
```

## 关键约束

- **`handleApproval` 是唯一合法的审批入口**，Agent 适配器禁止直接向终端写入 `y\n`
- 超时时间可在创建时配置，默认 0（不超时），生产建议设为 30 分钟
- 审批记录写入 SQLite（由 SessionManager 负责），用于审计

## 状态机转换

```
waiting ──[approved]──→ running
waiting ──[rejected]──→ paused
```

## 前端交互流程

```
后端 approval:required 事件
       ↓
CommandCenter 审批队列新增一条
       ↓
用户点击 [批准] / [拒绝]
       ↓
前端发送 approval:decision { sessionId, decision }
       ↓
后端 handleApproval() 恢复/终止 Agent
       ↓
后端推送 session:status 更新
       ↓
前端画布/看板节点颜色更新
```
