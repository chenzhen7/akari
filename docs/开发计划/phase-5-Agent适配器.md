# 阶段五：Agent 适配层

**状态**：🔲 待开始 | **预计工时**：2~3 天 | **前置**：阶段二 + 阶段三

---

## 5.1 适配器接口

文件：`apps/server/src/agent-adapters/base.ts`

```typescript
interface AgentAdapter {
  start(task: string, cwd: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  sendMessage(msg: string): Promise<void>;
  onCheckpoint(callback: CheckpointHandler): void;
}
```

## 5.2 Claude Code 适配器

文件：`apps/server/src/agent-adapters/claude.ts`

- [ ] 通过 TerminalMultiplexer 启动 `claude` CLI 进程
- [ ] 注入 Checkpoint / ApprovalRequired system prompt
- [ ] 解析 `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 标记

## 5.3 Aider 适配器

文件：`apps/server/src/agent-adapters/aider.ts`

- [ ] 启动 `aider` 进程，配置 `--no-auto-commits`
- [ ] 适配 Aider 输出格式，转换为统一 Checkpoint 协议

## 5.4 自定义 Shell 适配器

- [ ] 通用 Shell 适配器：支持任意 CLI 命令 + 正则 Checkpoint 映射规则
- [ ] 创建会话时可选 Agent 类型（claude / aider / shell）

---

## Checkpoint 标记格式

```
[CHECKPOINT] <描述>
[APPROVAL_REQUIRED] type=destructive command="<命令>"
[APPROVAL_REQUIRED] type=merge-ready
```
