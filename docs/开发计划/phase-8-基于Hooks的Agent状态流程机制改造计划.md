# 阶段八：基于 HTTP Hooks 的 Agent 状态流程机制改造计划

## 1. 背景与改造动因

### 1.1 现有机制与痛点
当前 Akari 的状态流转和审批触发主要依赖于 `TerminalMultiplexer` (`apps/server/src/terminal-mux.ts`) 中的 `detectMarkers()` 方法，捕获 Stdout 中的特定魔法字符串前缀（`[APPROVAL_REQUIRED]`、`[SPAWN_AGENT]`、`[TASK_DONE]`、`[DELEGATE]`、`[AWAIT_SESSION]` 等）。
这种机制存在以下根本性缺陷：
1. **匹配脆弱且易失真**：终端输出可能因转义字符、换行截断、ANSI 颜色序列或并发输出而导致正则完全失配，状态机静默停滞。
2. **缺乏细粒度拦截能力**：无法在 Agent 执行具体工具（如 `Edit`、`Bash` 危险命令）**之前**进行精准拦截，只能在 Agent 打印字符串之后才能响应，审批无法真正阻断工具调用。
3. **语义不可靠**：Agent 输出魔法字符串是"尽力而为"的约定，提示词可能失效，没有任何结构化保证。

### 1.2 改造目标
**完全废弃 Stdout 魔法字符串机制**，全面转向 **纯 HTTP Hook 单轨驱动**：
- **Akari 作为 Hook 服务器**：在本地暴露标准 REST 端点 `POST /api/sessions/:id/hooks`，供 Agent 的 Hook 处理程序投递生命周期事件。
- **同步阻塞审批**：利用 HTTP 请求挂起特性，在 Agent 调用危险工具前阻塞其执行，用户决策后服务器才返回 HTTP 响应，Agent 根据响应决定是否继续。
- **MCP 工具替代魔法字符串**：子 Agent 创建（原 `[SPAWN_AGENT]`）、委托（原 `[DELEGATE]`）等协作操作，改由 Agent 调用 Akari 提供的 **MCP 工具**来实现，调用本身触发 `PreToolUse` Hook，Akari 在服务端处理业务逻辑。
- **`TerminalMultiplexer` 职责收窄**：`detectMarkers()` 方法及全部魔法字符串正则**完全删除**，`terminal-mux.ts` 仅保留 PTY 生命周期管理（`terminal:data`、`terminal:exit`、`terminal:ready`）。

---

## 2. 系统架构设计

```
┌──────────────────────────────────────────────────────────┐
│                        Agent 运行端                       │
│                                                          │
│  Claude Code 实例（在 Worktree 中运行）                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  .claude/settings.json (由 Akari 自动写入)          │  │
│  │  → hooks.PreToolUse   → HTTP POST /api/sessions/:id/hooks │
│  │  → hooks.PermissionRequest → 同上                   │  │
│  │  → hooks.SessionStart / Stop / SessionEnd → 同上    │  │
│  └────────────────────────┬───────────────────────────┘  │
│                           │ HTTP POST (同步，可阻塞)       │
│  调用 Akari MCP 工具       │                              │
│  akari_spawn_agent()  ────┤                              │
│  akari_delegate()     ────┤                              │
└───────────────────────────┼──────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│                   Akari 后端 (apps/server)                │
│                                                          │
│  POST /api/sessions/:id/hooks                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │              HookDispatcher                      │    │
│  │  dispatch(sessionId, hookEvent)                  │    │
│  │  ├─ PermissionRequest       → ApprovalRegistry    │    │
│  │  │                          ↕ Promise 挂起       │    │
│  │  │  POST /api/sessions/:id/approval 决策唤醒      │    │
│  │  ├─ PreToolUse (akari_spawn_agent) → 创建子会话  │    │
│  │  ├─ PreToolUse (akari_delegate)   → 转发消息     │    │
│  │  ├─ SessionStart   → 状态: running               │    │
│  │  └─ StopFailure    → 状态: failed                │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  TerminalMultiplexer (仅保留 PTY 管理)                    │
│  terminal:data / terminal:exit / terminal:ready          │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 核心协议定义（shared-types）

在 `@akari/shared-types` 中引入结构化的 Hook 事件类型定义。

### 3.1 核心 Hook 事件集

> **语义说明**：
> - `TaskCreated` / `TaskCompleted` 是 Claude **内部 Todo 子任务**（`TodoWrite` 条目）事件，**不驱动 Session 状态机**。
> - `PermissionRequest` 负责所有工具调用的权限拦截，`PreToolUse` 仅用于 Akari MCP 工具调用的业务路由。
> - 原有魔法字符串（`[SPAWN_AGENT]`、`[DELEGATE]` 等）全部废弃，改由 Agent 调用 **Akari MCP 工具**实现，调用本身触发 `PreToolUse` Hook。
> - Session 完成/归档由用户手动操作触发，任何 Hook 事件均不自动驱动。

| 事件名称 | 来源 | 发生时机 | 状态映射 & 行为 |
| :--- | :--- | :--- | :--- |
| `SessionStart` | Claude Code Native | 会话进程启动或恢复 | `initializing` → `running` |
| `PreToolUse` ⏸️ | Akari MCP | Agent 调用 `akari_spawn_agent` MCP 工具 | 服务端创建子会话（`initializing` → `running`），HTTP 响应 `allow` |
| `PreToolUse` ⏸️ | Akari MCP | Agent 调用 `akari_delegate` MCP 工具 | 服务端向目标 Session PTY 转发消息，HTTP 响应 `allow` |
| `PermissionRequest` | Claude Code Native | Claude 显式请求权限 | `running` → `waiting`，触发审批工作流 |
| `PostToolUse` | Claude Code Native | 工具调用成功完成后 | 仅记录 Activity 面板（可选），不改变状态 |
| `TaskCreated` | Claude Code Native | Claude 内部 TodoWrite 子任务创建 | 仅记录日志 / Activity 面板，**不驱动状态机** |
| `TaskCompleted` | Claude Code Native | Claude 内部 TodoWrite 子任务勾选 | 仅记录日志 / Activity 面板，**不驱动状态机** |
| `Stop` | Claude Code Native | 当前轮次回复结束（保持会话活跃） | 状态保持 `running`，等待下一轮交互 |
| `StopFailure` | Claude Code Native | API 报错、token 超限等异常终止 | `running` → `failed`，广播 Toast 错误 |

### 3.2 报文协议示例（以 `PreToolUse` 为例）⏸️ 暂不做

**Agent → Akari HTTP POST 请求体（Claude Code 原生格式）：**
```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "...",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf ./.agent-worktrees/temp"
  }
}
```

**Akari 响应体（HTTP 200，`permissionDecision` 控制 Agent 是否继续）：**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "approved",
    "permissionDecisionReason": "User approved via Akari Command Center"
  }
}
```

> 当需要审批时，Akari **挂起 HTTP 响应**（不回写任何数据）直到用户在前端点击决策，Claude Code 进程在此期间完全阻塞等待。

---

## 4. 关键技术点实现原理

### 4.1 HTTP 同步阻塞审批机制（挂起与唤醒）
当 Agent 发送 `PreToolUse` (HTTP) 请求，且该命令需用户批准时，Akari 后端将：
1. **生成 Deferred Promise**：拦截该 HTTP 请求，不立即响应，而是将请求的 `res` 句柄和控制权暂存至 `ApprovalRegistry`。
2. **驱动状态机**：将 Session 状态变更为 `waiting` (待审批)，并向前端广播。
3. **用户决策触发**：
   - 用户在前端点击 **“批准”** -> 后端调用 `registry.resolve(sessionId, 'approved')` -> HTTP 响应返回 `{ permissionDecision: "approved" }` -> Agent 恢复执行。
   - 用户点击 **“拒绝”** -> 后端调用 `registry.resolve(sessionId, 'rejected')` -> HTTP 响应返回 `{ permissionDecision: "rejected" }` -> Agent 终止该工具调用并重试或汇报。

```typescript
// apps/server/src/services/approval-registry.ts 伪代码
export class ApprovalRegistry {
  private pendingRequests = new Map<string, {
    resolve: (decision: string) => void;
    reject: (err: any) => void;
  }>();

  async waitForApproval(sessionId: string, details: any): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(sessionId, { resolve, reject });
      // 触发状态转移
      sessionManager.updateStatus(sessionId, 'waiting');
      // 广播审批事件
      sessionManager.broadcastApprovalRequired(sessionId, details);
    });
  }

  resolveApproval(sessionId: string, decision: 'approved' | 'rejected') {
    const pending = this.pendingRequests.get(sessionId);
    if (pending) {
      pending.resolve(decision);
      this.pendingRequests.delete(sessionId);
    }
  }
}
```

### 4.2 MCP 工具替代魔法字符串 ⏸️ 暂不做

原来的 `[SPAWN_AGENT]`、`[DELEGATE]`、`[AWAIT_SESSION]` 全部废弃。Agent 改用 Akari 提供的 **MCP 工具**完成相同操作：

| 废弃的魔法字符串 | 替代 MCP 工具 | 工具调用触发的 Hook | Akari 服务端处理 |
| :--- | :--- | :--- | :--- |
| `[SPAWN_AGENT]` | `akari_spawn_agent(task, agentType, branch?)` | `PreToolUse` | 创建子会话，返回 `sessionId` |
| `[DELEGATE]` | `akari_delegate(sessionId, message)` | `PreToolUse` | 向目标 PTY 转发消息 |
| `[AWAIT_SESSION]` | `akari_await_session(sessionId, timeoutSec?)` | `PreToolUse` | 轮询目标 Session 状态直到 completed，长轮询实现 |
| `[APPROVAL_REQUIRED]` | 由 `PreToolUse` / `PermissionRequest` Hook 自动触发 | — | 不再需要 Agent 主动打印 |

MCP 服务器在 Worktree 初始化时，由 `ClaudeAdapter` 在 `.claude/settings.json` 的 `mcpServers` 字段中**自动注册 Akari MCP Server**（本地进程或 HTTP）。

---

## 5. 详细开发计划

### 阶段 8.1：前后端协议与类型升级 (优先级：高)
- **【BE/FE】类型同步**：在 `packages/shared-types/src/index.ts` 中，增加 `HookEvent`、`PreToolUsePayload`、`HookResponse` 等全量类型定义。
- **【BE】暴露 HTTP Hook 路由**：
  - 在 `apps/server/src/index.ts` 注册 `POST /api/sessions/:id/hooks`，由 Fastify 接收并传入 `HookDispatcher`。

### 阶段 8.2：后端核心事件分发层 `HookDispatcher` 实现 (优先级：高)
- **新建** `apps/server/src/hook-dispatcher.ts`：
  - 实现 `dispatch(sessionId, hookEvent)` 方法，根据 `hook_event_name` 路由：
    - `SessionStart` → `updateStatus('running')`
    - `PreToolUse`（MCP 工具 `akari_spawn_agent` / `akari_delegate` / `akari_await_session`） → 执行对应业务逻辑，立即返回 `allow` ⏸️ **暂不做**
    - `PermissionRequest` → `ApprovalRegistry.waitForApproval()`，挂起 HTTP 响应
    - `PostToolUse` / `TaskCreated` / `TaskCompleted` / `Stop` → 记录 Activity，不驱动状态机
    - `StopFailure` → `updateStatus('failed')`
  - 维护 `ApprovalRegistry`（Map<sessionId, DeferredPromise>）暂存阻塞中的 HTTP 连接。
- **关联 `SessionManager`**：确保 `updateStatus` 能被 HookDispatcher 安全调用。

### 阶段 8.3：清理 `TerminalMultiplexer` 魔法字符串 (优先级：高)
- **删除** `apps/server/src/terminal-mux.ts` 中的 `detectMarkers()` 方法及其全部内容。
- **删除** 对应的所有 `emit` 调用：`'approval:required'`、`'spawn_agent'`、`'delegate'`、`'task_done'`、`'await_session'`。
- **保留** PTY 核心职责：`terminal:data`、`terminal:exit`、`terminal:ready`、`sendToTerminal`、`resizeTerminal`。
- **更新** `session-manager.ts` 中原先监听上述 emit 事件的 `wireEvents()` 方法，移除所有魔法字符串相关的事件绑定。

### 阶段 8.4：ClaudeAdapter 注入 Hook 配置与 MCP 服务器 (优先级：高) ⏸️ **暂不做**（PreToolUse/MCP 部分）
- **【BE】Worktree 初始化时自动写入** `.claude/settings.json`：
  ```json
  {
    "hooks": {
      "PreToolUse":       [{ "type": "http", "url": "http://localhost:3001/api/sessions/SESSION_ID/hooks" }],  // ⏸️ 暂不做
      "PermissionRequest":[{ "type": "http", "url": "http://localhost:3001/api/sessions/SESSION_ID/hooks" }],
      "SessionStart":     [{ "type": "http", "url": "http://localhost:3001/api/sessions/SESSION_ID/hooks" }],
      "Stop":             [{ "type": "http", "url": "http://localhost:3001/api/sessions/SESSION_ID/hooks" }],
      "StopFailure":      [{ "type": "http", "url": "http://localhost:3001/api/sessions/SESSION_ID/hooks" }]
    },
    "mcpServers": {
      "akari": {
        "type": "http",
        "url": "http://localhost:3001/mcp"
      }
    }
  }
  ```
> ⏸️ **暂不做**：以下 MCP Server 及 PreToolUse 路由全部推迟实现。

- **【BE】新建 Akari MCP Server** `apps/server/src/mcp-server.ts`，暴露工具：
  - `akari_spawn_agent(task, agentType, branch?)` → 转发至 `SessionManager.createSession()`
  - `akari_delegate(sessionId, message)` → 转发至 `TerminalMultiplexer.sendToTerminal()`
  - `akari_await_session(sessionId, timeoutSec?)` → 长轮询 Session 状态

### 阶段 8.5：前端 UI 增强：审批面板与节点可视化 (优先级：低)
- **【FE】审批面板**：
  - 升级审批弹窗，结构化展示 `PreToolUse` 的工具名称（如"调用 `Bash`"）、具体参数、高危标签。
- **【FE】Canvas 节点脉冲**：
  - `SessionNode` 在 `waiting` 状态（挂起等待审批）时显示橙色脉冲光晕；`running` 状态恢复正常。
- **【FE】SessionNode Activity Ticker（静态单行）**：
  - 位于 `SessionNode` 卡片内 miniTerminal 下方，单行静态展示最新 Hook 事件，超出宽度截断用 `…`。
  - 与 Checkpoint 机制共存：Checkpoint 仍通过终端输出展示，Ticker 专门展示结构化 Hook 事件。

  **ASCII 原型：**
  ```
  ┌──────────────────────────────────────────┐
  │  [🤖]  refactor-auth-module      🟢运行中 │
  │  🌿 agent/refactor-auth-7f3a9b2c         │
  │  ─────────────────────────────────────── │
  │  [运行中] [Orchestrator] [claude]         │
  │  ═══════════════════════════════════════ │
  │  ● ● ●  7f3a9b2c                         │
  │  > npm run test                          │
  │  > Test passed: 14/14                    │
  │  > git commit -m "add auth hooks"        │
  │  > [CHECKPOINT] 完成重构                 │
  │  ─────────────────────────────────────── │
  │  🟣 spawn_agent(task=编写测试) → akari-x1 │  ← Activity Ticker（单行，贴底）
  └──────────────────────────────────────────┘
  ```

  **事件类型与图标映射：**

  | 事件 | 图标 | 示例文本 |
  |------|------|----------|
  | `PermissionRequest` | ⏳ | `⏳ 审批 Bash: rm -rf dist` |
  | `PostToolUse` | ✅ | `✅ Bash: git push 完成` |
  | `PreToolUse` (MCP) | 🟣 | `🟣 spawn_agent → akari-x1` |
  | `TaskCreated` | 📝 | `📝 任务: 实现审批Registry` |
  | `TaskCompleted` | ✓ | `✓ 任务完成: 实现审批Registry` |
  | `StopFailure` | 🔴 | `🔴 API rate limit` |
  | `SessionStart` | 🟢 | `🟢 会话恢复运行` |

---

## 6. 状态转移矩阵与动作映射

| 触发 Hook 事件 | 条件 / 工具名 | 目标状态 | 触发后续动作 |
| :--- | :--- | :--- | :--- |
| `SessionStart` | — | `running` | 广播连接灯变绿 |
| `PreToolUse` ⏸️ | MCP `akari_spawn_agent` | 不变 | 创建子会话，立即返回 `allow` + sessionId |
| `PreToolUse` ⏸️ | MCP `akari_delegate` | 不变 | PTY 转发消息，立即返回 `allow` |
| `PreToolUse` ⏸️ | MCP `akari_await_session` | 不变 | 长轮询目标状态，完成后返回 `allow` |
| `PermissionRequest` | 显式权限请求 | `waiting` | HTTP 挂起，前端弹审批弹窗 |
| `PostToolUse` | — | 不变 | 记录 Activity 面板（可选） |
| `TaskCreated` | Claude 内部 Todo 条目 | 不变 | 记录 Activity 面板，**不驱动状态机** |
| `TaskCompleted` | Claude 内部 Todo 条目 | 不变 | 记录 Activity 面板，**不驱动状态机** |
| `Stop` | 正常轮次结束（会话保持活跃） | 不变 | 无，等待下一轮交互 |
| `StopFailure` | API 报错、rate_limit 等 | `failed` | 广播 Toast 错误 |
