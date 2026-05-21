# TerminalMultiplexer 模块设计

> 对应功能模块 **F3（终端多路复用）**，前置依赖 F1（SessionManager）。  
> 文件位置：`apps/server/src/terminal-mux.ts`

## 职责

- 为每个会话创建独立 PTY 进程（node-pty）
- 捕获终端输出，广播给前端（WebSocket `terminal:data`）
- 检测 Agent 输出中的 Checkpoint / ApprovalRequired 标记
- 支持向单个或多个终端写入（广播消息）
- 维护环形 Buffer（最多 5000 行），供新连接的前端补偿历史

## 实现代码

```typescript
// apps/server/src/terminal-mux.ts
import { spawn, IPty } from 'node-pty';
import { EventEmitter } from 'events';

interface TerminalSession {
  id: string;
  pty: IPty;
  buffer: Array<{ type: 'output'; data: string; timestamp: number }>;
  status: 'idle' | 'running' | 'exited';
}

export class TerminalMultiplexer extends EventEmitter {
  private terminals = new Map<string, TerminalSession>();
  private readonly BUFFER_LIMIT = 5000;

  createTerminal(sessionId: string, cwd: string): TerminalSession {
    const pty = spawn('bash', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
      env: { ...process.env, AGENT_SESSION_ID: sessionId },
    });

    const session: TerminalSession = { id: sessionId, pty, buffer: [], status: 'running' };

    pty.onData((data) => {
      // 环形 Buffer
      if (session.buffer.length >= this.BUFFER_LIMIT) session.buffer.shift();
      session.buffer.push({ type: 'output', data, timestamp: Date.now() });

      this.emit('terminal:data', { sessionId, data });
      this.detectMarkers(sessionId, data);
    });

    pty.onExit(({ exitCode }) => {
      session.status = 'exited';
      this.emit('terminal:exit', { sessionId, exitCode });
    });

    this.terminals.set(sessionId, session);
    return session;
  }

  sendToTerminal(sessionId: string, data: string) {
    this.terminals.get(sessionId)?.pty.write(data);
  }

  broadcastToAll(data: string, sessionIds?: string[]) {
    const targets = sessionIds ?? Array.from(this.terminals.keys());
    targets.forEach(id => this.sendToTerminal(id, data));
  }

  getBuffer(sessionId: string, lastN = 100) {
    return this.terminals.get(sessionId)?.buffer.slice(-lastN) ?? [];
  }

  private detectMarkers(sessionId: string, data: string) {
    const approvalMatch = data.match(/\[APPROVAL_REQUIRED\] (.+)/);
    if (approvalMatch) {
      this.emit('approval:required', { sessionId, ...this.parseApproval(approvalMatch[1]) });
    }

    const checkpointMatch = data.match(/\[CHECKPOINT\] (.+)/);
    if (checkpointMatch) {
      this.emit('checkpoint:reached', { sessionId, message: checkpointMatch[1] });
    }
  }

  private parseApproval(raw: string) {
    // type=destructive command="rm -rf dist"
    // type=merge-ready
    const type = raw.match(/type=(\S+)/)?.[1] ?? 'unknown';
    const command = raw.match(/command="([^"]+)"/)?.[1];
    return { type, command };
  }
}
```

## 发射的事件

| 事件名 | Payload | 监听方 |
|--------|---------|--------|
| `terminal:data` | `{ sessionId, data }` | WS Server → 前端 |
| `terminal:exit` | `{ sessionId, exitCode }` | SessionManager |
| `approval:required` | `{ sessionId, type, command? }` | ApprovalWorkflow |
| `checkpoint:reached` | `{ sessionId, message }` | SessionManager |

## Windows 注意事项

- `node-pty` 需要 Visual C++ Build Tools，**建议 WSL2 / macOS 开发**
- Windows 降级方案：用 `child_process.spawn` 替代，失去 PTY 特性（颜色/进度条不可用）

## 依赖安装

```bash
pnpm add node-pty
pnpm add -D @types/node
```
