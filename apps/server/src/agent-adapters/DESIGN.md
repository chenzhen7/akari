# Agent 适配器模块设计

> 对应功能模块 **F6（Agent 适配层）**，前置依赖 F2（WorktreeManager）+ F3（TerminalMux）。  
> 文件位置：`apps/server/src/agent-adapters/`

## 统一接口

```typescript
// base.ts
export interface AgentAdapter {
  start(task: string, cwd: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  sendMessage(msg: string): Promise<void>;
  onCheckpoint(callback: (msg: string) => void): void;
}
```

## Claude Code 适配器

```typescript
// claude.ts
import { TerminalMultiplexer } from '../terminal-mux';

export class ClaudeAdapter implements AgentAdapter {
  constructor(private termMux: TerminalMultiplexer, private sessionId: string) {}

  async start(task: string, cwd: string) {
    const systemPrompt = [
      '当你完成重要步骤时，输出: [CHECKPOINT] <描述>',
      '当你需要执行危险操作时，输出: [APPROVAL_REQUIRED] type=destructive command="<命令>"',
      '当你准备好合并时，输出: [APPROVAL_REQUIRED] type=merge-ready',
    ].join('\n');

    // 通过 TerminalMux 在 worktree cwd 中运行 claude CLI
    this.termMux.sendToTerminal(this.sessionId,
      `claude --system "${systemPrompt}" --message "${task}"\n`
    );
  }

  async pause()  { this.termMux.sendToTerminal(this.sessionId, '\x03'); }  // Ctrl+C
  async resume() { this.termMux.sendToTerminal(this.sessionId, 'claude --continue\n'); }
  async sendMessage(msg: string) { this.termMux.sendToTerminal(this.sessionId, `${msg}\n`); }
  onCheckpoint(cb: (msg: string) => void) {
    this.termMux.on('checkpoint:reached', ({ sessionId, message }) => {
      if (sessionId === this.sessionId) cb(message);
    });
  }
}
```

## Aider 适配器

```typescript
// aider.ts
export class AiderAdapter implements AgentAdapter {
  constructor(private termMux: TerminalMultiplexer, private sessionId: string) {}

  async start(task: string, cwd: string) {
    // --no-auto-commits：由 WorktreeManager 控制提交时机
    // --yes-always：配合审批系统，危险操作由 [APPROVAL_REQUIRED] 标记拦截
    this.termMux.sendToTerminal(this.sessionId,
      `aider --message "${task}" --no-auto-commits --yes-always\n`
    );
  }

  async pause()  { this.termMux.sendToTerminal(this.sessionId, '\x03'); }
  async resume() { this.termMux.sendToTerminal(this.sessionId, ''); }
  async sendMessage(msg: string) { this.termMux.sendToTerminal(this.sessionId, `${msg}\n`); }
  onCheckpoint(cb: (msg: string) => void) {
    // Aider 无原生 checkpoint，解析其输出格式映射
    this.termMux.on('checkpoint:reached', ({ sessionId, message }) => {
      if (sessionId === this.sessionId) cb(message);
    });
  }
}
```

## 自定义 Shell 适配器

```typescript
// shell.ts — 通用：任意 CLI 命令 + 正则 Checkpoint 映射
export class ShellAdapter implements AgentAdapter {
  constructor(
    private termMux: TerminalMultiplexer,
    private sessionId: string,
    private command: string,          // e.g. "python agent.py"
    private checkpointPattern?: RegExp,
  ) {}

  async start(task: string, _cwd: string) {
    this.termMux.sendToTerminal(this.sessionId, `${this.command} "${task}"\n`);
  }
  // ... pause / resume / sendMessage 同上
}
```

## 工厂函数

```typescript
// index.ts
export function createAdapter(
  type: 'claude' | 'aider' | 'shell',
  termMux: TerminalMultiplexer,
  sessionId: string,
  options?: Record<string, unknown>,
): AgentAdapter {
  switch (type) {
    case 'claude': return new ClaudeAdapter(termMux, sessionId);
    case 'aider':  return new AiderAdapter(termMux, sessionId);
    case 'shell':  return new ShellAdapter(termMux, sessionId, options?.command as string);
    default: throw new Error(`Unknown agent type: ${type}`);
  }
}
```

## 前端创建会话时的类型选择

创建会话弹窗（`CreateSessionDialog`）需新增「Agent 类型」下拉选项，传入 `POST /sessions` body：

```json
{
  "name": "feat/auth",
  "task": "实现用户认证模块",
  "baseBranch": "main",
  "agentType": "claude"
}
```
