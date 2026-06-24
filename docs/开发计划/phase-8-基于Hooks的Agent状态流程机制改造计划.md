# 阶段八：基于 HTTP Hooks 的 Agent 状态流程机制改造计划

> **更新时间**：2026-06-24
> **当前状态**：核心 Hook 基础设施完成（8.1–8.4），PermissionRequest 同步阻塞审批未实现（8.5 UI 占位），PreToolUse/MCP 部分留待后续阶段。

## 1. 背景与改造动因

### 1.1 旧机制痛点

原有 `TerminalMultiplexer` (`apps/server/src/terminal-mux.ts`) 的 `detectMarkers()` 通过捕获 Stdout 魔法字符串（`[APPROVAL_REQUIRED]`、`[SPAWN_AGENT]` 等）驱动状态机，存在根本性缺陷：

1. **匹配脆弱**：ANSI 颜色序列、并发输出、换行截断均可导致正则失配
2. **无法前置拦截**：只能在 Agent 打印字符串后才能响应，审批无法真正阻断危险工具调用
3. **语义不可靠**：魔法字符串是尽力而为的约定，无结构化保证

### 1.2 改造目标

**完全废弃 Stdout 魔法字符串机制**，全面转向 **HTTP Hook 单轨驱动**：

- **Akari 作为 Hook 服务器**：暴露标准 REST 端点 `POST /sessions/:id/hooks`，供 Agent 的 Hook 处理程序投递生命周期事件
- **状态驱动的 UI**：`waiting` 状态节点显示橙色脉冲光晕，指挥中心显示待审批数量角标（当前为占位效果）
- **`TerminalMultiplexer` 职责收窄**：`detectMarkers()` 及全部魔法字符串正则**已删除**，仅保留 PTY 生命周期管理

> **已废弃功能（PreToolUse/MCP）**：`akari_spawn_agent` / `akari_delegate` MCP 工具及 Akari MCP Server 暂不实现，留待后续阶段。

---

## 2. 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                        Agent 运行端                       │
│  Claude Code 实例（在 Worktree 中运行）                    │
│  .claude/settings.local.json                             │
│  hooks.PermissionRequest  → HTTP POST /sessions/:id/hooks│
│  hooks.SessionStart        → 同上                          │
│  hooks.Stop               → 同上                          │
│  hooks.StopFailure        → 同上                          │
│  hooks.UserPromptSubmit   → 同上                          │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTP POST（当前非阻塞）
                             ▼
┌──────────────────────────────────────────────────────────┐
│                   Akari 后端 (apps/server)               │
│  POST /sessions/:id/hooks  → HookDispatcher              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ HookDispatcher (apps/server/src/hook-dispatcher.ts)│ │
│  │  dispatchHookEvent(sessionId, event)                │  │
│  │  ├─ SessionStart    → updateStatus('idle')          │  │
│  │  ├─ UserPromptSubmit→ paused/waiting/idle → running│  │
│  │  ├─ PermissionRequest→ 仅记录日志，不修改状态       │  │
│  │  │                    （不挂起 HTTP 请求）          │  │
│  │  ├─ Stop           → running/waiting → idle        │  │
│  │  │                    + 广播 session:lastMessage    │  │
│  │  ├─ StopFailure    → updateStatus('failed')        │  │
│  │  └─ PostToolUse / TaskCreated / TaskCompleted → {}  │  │
│  └──────────────────────────────────────────────────┘  │
│  TerminalMultiplexer（仅保留 PTY 管理）                   │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 核心协议定义（shared-types）

### 3.1 Hook 事件集

| 事件名称 | 来源 | 发生时机 | 状态映射 & 行为 |
| :--- | :--- | :--- | :--- |
| `SessionStart` | Claude Code Native | 会话进程启动或恢复 | `initializing` → `idle` |
| `UserPromptSubmit` | Claude Code Native | 用户提交提示 | `paused` / `waiting` / `idle` → `running`（恢复会话） |
| `PermissionRequest` | Claude Code Native | Claude 请求权限 | **当前不修改状态，仅记录日志**；不阻塞 Claude Code 原生权限流程 |
| `Stop` | Claude Code Native | 当前轮次回复结束 | `running` / `waiting` → `idle`；提取 `last_assistant_message` 存入 `lastAiMessage`，广播 `session:lastMessage` |
| `StopFailure` | Claude Code Native | API 报错/token 超限 | `running` / `paused` / `waiting` → `failed` |
| `PostToolUse` | Claude Code Native | 工具调用成功 | 无操作（预留） |
| `TaskCreated` | Claude Code Native | Claude 内部 TodoWrite 创建 | 无操作（Claude 内部任务） |
| `TaskCompleted` | Claude Code Native | Claude 内部 TodoWrite 勾选 | 无操作（Claude 内部任务） |

> **废弃**：原有魔法字符串（`[SPAWN_AGENT]`、`[DELEGATE]`、`[CHECKPOINT]`、`[APPROVAL_REQUIRED]` 等）已完全删除。

### 3.2 HTTP 请求/响应示例

**Agent → Akari POST /sessions/:id/hooks**

```json
{
  "hook_event_name": "PermissionRequest",
  "session_id": "abc123",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf ./dist" }
}
```

**Akari → Agent 响应（当前始终立即返回）**

```json
{}
```

> **注意**：当前 `PermissionRequest` 不返回 `permissionDecision`，HTTP 请求不会挂起。后续实现同步阻塞审批时，响应格式将改为：
> ```json
> {
>   "hookSpecificOutput": {
>     "hookEventName": "PermissionRequest",
003e     "permissionDecision": "approve",
>     "permissionDecisionReason": "User approved via Akari"
>   }
> }
> ```

---

## 4. 关键技术点

### 4.1 HTTP 同步阻塞审批（待实现）

**当前实现**：`PermissionRequest` 仅打印日志并立即返回 `{}`，**不挂起、不阻塞** Claude Code 的原生权限确认流程。

**目标实现**：
```
Agent 发送 PermissionRequest
    → HookDispatcher.setWaitingForApproval()
    → ApprovalRegistry.waitForApproval() [Promise 挂起]
    → Session 状态变为 waiting，前端显示橙色脉冲 + 指挥中心角标
    ← 用户点击"批准"
    → ApprovalRegistry.resolveApproval(sessionId, 'approved')
    → Promise resolve，HTTP 响应返回 permissionDecision: "approve"
    → Agent 继续执行
```

### 4.2 ClaudeAdapter Hook 配置注入

**核心文件**：`apps/server/src/agent-adapters/claude.ts`（`writeClaudeSettings`）

Worktree 初始化时自动写入 `.claude/settings.local.json`，注入以下 Hook：

| Hook 事件 | 行为 |
| :--- | :--- |
| `PermissionRequest` | HTTP POST → 当前仅记录日志 |
| `SessionStart` | `initializing` → `idle` |
| `Stop` | `running` / `waiting` → `idle`，广播 `session:lastMessage` |
| `StopFailure` | `running` / `paused` / `waiting` → `failed` |
| `UserPromptSubmit` | `paused` / `waiting` / `idle` → `running` |

---

## 5. 详细开发计划

> 已完成项标记 ✅，待做项标记 ⏸️。

### 阶段 8.1：前后端协议与类型升级 ✅

- **【BE/FE】类型同步**：`packages/shared-types/src/index.ts` 中已定义 `HookEvent` / `HookResponse` / `HookEventName` 及全量 Payload 类型
- **【BE】暴露 HTTP Hook 路由**：`POST /sessions/:id/hooks` 已注册，由 `dispatchHookEvent` 处理

### 阶段 8.2：后端核心事件分发层 ✅

- **【BE】** `apps/server/src/hook-dispatcher.ts`：
  - `SessionStart` → `updateStatus('idle')`
  - `UserPromptSubmit` → `paused` / `waiting` / `idle` → `running`
  - `PermissionRequest` → 仅记录日志，不修改状态
  - `Stop` → `running` / `waiting` → `idle`，提取 `last_assistant_message`，广播 `session:lastMessage`
  - `StopFailure` → `updateStatus('failed')`
  - `PostToolUse` / `TaskCreated` / `TaskCompleted` → `{}`（无操作）

### 阶段 8.3：清理 TerminalMultiplexer 魔法字符串 ✅

- `detectMarkers()` 方法及全部魔法字符串正则**已删除**
- `terminal-mux.ts` 仅保留 PTY 生命周期管理（`terminal:data`、`terminal:exit`、`terminal:ready`）

### 阶段 8.4：ClaudeAdapter 注入 Hook 配置 ✅

- `writeClaudeSettings()` 已实现，Worktree 初始化时自动写入 `.claude/settings.local.json`
- `PermissionRequest`、`SessionStart`、`Stop`、`StopFailure`、`UserPromptSubmit` 均已注入

### 阶段 8.5：审批 UI 占位（当前未生效）⏸️

- **【FE】Canvas 节点脉冲**：`waiting` 状态显示橙色脉冲光晕（代码存在，但 `PermissionRequest` 不会触发 `waiting`）
- **【FE】指挥中心角标**：TopNav "指挥中心" 按钮显示待审批数量角标（当前恒为 0）
- **【FE】Canvas 节点消息区**：显示 `lastAiMessage`，支持换行，字体 9px，最小 4 行，最大 8 行

### 阶段 8.6：同步阻塞审批（⏸️ 待实现）

- 实现 `ApprovalRegistry`，让 `PermissionRequest` Hook 挂起 HTTP 请求
- 实现 `POST /sessions/:id/approval` 决策接口唤醒挂起的 Promise
- `waiting` 状态真实触发，指挥中心角标真实计数

### 阶段 8.7：PreToolUse / MCP（⏸️ 暂不做）

- `akari_spawn_agent` / `akari_delegate` MCP 工具及 Akari MCP Server 留待后续阶段

---

## 6. 验收清单

### 6.1 基础设施

- [x] **F1** `POST /sessions/:id/hooks` 路由存在，对合法 id 返回 200，对未知 id 返回 404
- [x] **F2** Claude 会话 Worktree 下生成 `.claude/settings.local.json`，包含所有 Hook 配置
- [x] **F3** `TerminalMultiplexer` 不再处理魔法字符串（已删除 `detectMarkers`）

### 6.2 Hook 事件

- [x] **S1** `SessionStart` → `initializing` → `idle`
- [x] **U1** `UserPromptSubmit` → `paused` / `waiting` / `idle` → `running`
- [x] **T1** `Stop` → `lastAiMessage` 更新，画布节点消息区实时刷新
- [x] **E1** `StopFailure` → session → `failed`
- [ ] **P1** `PermissionRequest` → HTTP 挂起，session → `waiting`（⏸️ 待实现）
- [ ] **P2** Canvas 节点橙色脉冲，指挥中心角标显示数量（⏸️ 待实现）
- [ ] **P3** 点击"批准" → HTTP 响应 `permissionDecision: "approve"`，session → `running`（⏸️ 待实现）
- [ ] **P4** 点击"拒绝" → HTTP 响应 `permissionDecision: "deny"`，session → `paused`（⏸️ 待实现）

### 6.3 非 Hook 会话

- [x] **B1** Shell 类型会话（无 Hook 注入）不依赖 Hook 即可进入 `running`；终端退出后按 exit code 进入 `completed` / `failed`

---

## 7. 端到端验证步骤

**前置条件**

```powershell
# 终端 A：启动全栈
pnpm dev:all
# 前端 http://localhost:5173  后端 http://localhost:3001
```

### 步骤 1：检查 settings.local.json（验 F2）

```powershell
$id = "<SESSION_ID>"
cat "G:\Study_Data\VSCode\akari\.agent-worktrees\$id\.claude\settings.local.json"
```

期望：JSON 包含 `hooks.PermissionRequest` / `SessionStart` / `Stop` / `StopFailure` / `UserPromptSubmit`，URL 中含正确的 `$id`。

### 步骤 2：SessionStart（验 S1）

```powershell
$id = "<SESSION_ID>"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/$id/hooks" `
  -Method POST -ContentType "application/json" `
  -Body '{"hook_event_name":"SessionStart","session_id":"'"$id"'"}'
```

期望：命令立即返回 `{}`，前端节点状态变为「空闲中」。

### 步骤 3：模拟 PermissionRequest（当前不阻塞）

```powershell
$id = "<SESSION_ID>"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/$id/hooks" `
  -Method POST -ContentType "application/json" `
  -Body '{
    "hook_event_name": "PermissionRequest",
    "session_id": "'"$id"'",
    "tool_name": "Bash",
    "tool_input": { "command": "rm -rf dist/" }
  }'
```

期望：命令立即返回 `{}`，session 状态不变。后端日志出现审批记录。

### 步骤 4：Stop Hook（验 T1）

```powershell
$id = "<SESSION_ID>"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/$id/hooks" `
  -Method POST -ContentType "application/json" `
  -Body '{
    "hook_event_name": "Stop",
    "session_id": "'"$id"'",
    "last_assistant_message": "完成了重构，现在运行测试"
  }'
```

期望：session 状态变为 `idle`，画布节点消息区立即显示新消息（无需重新打开 Tab）。

### 步骤 5：StopFailure（验 E1）

```powershell
$id = "<SESSION_ID>"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/$id/hooks" `
  -Method POST -ContentType "application/json" `
  -Body '{
    "hook_event_name": "StopFailure",
    "session_id": "'"$id"'",
    "error": "API rate limit exceeded"
  }'
```

期望：节点状态变为「失败」（红色），终端面板出现红色错误行。

### 步骤 6：魔法字符串不再触发（验 F3）

向运行中的 PTY 输入：

```
[APPROVAL_REQUIRED] type=destructive command="rm -rf /"
```

期望：session 状态不变，无审批弹窗，字符串仅作为普通终端输出显示。

### 步骤 7：Shell 会话终端退出（验 B1）

1. 新建 **shell** 类型会话，等待其进入 `running`
2. 在终端中输入 `exit`
3. 期望：session 状态变为 `completed`（exit code 0）
