# 阶段五：Agent 适配层

**状态**：✅ 进行中（Claude ✅ 已实现，Aider / Shell 🔲 待实现） | **前置**：阶段二 + 阶段三

---

## 5.1 适配器接口（已实现）

文件：`apps/server/src/agent-adapters/base.ts`

> 采用"PTY 命令序列"模式。Agent 进程直接运行在已有的 PTY shell 中，无需独立的 pause/resume 控制。

```typescript
export interface PtyCommand {
  cmd: string       // 发送到 PTY 的原始字符串（含换行符）
  delayMs?: number  // 发送前等待的毫秒数（相对于前一条命令）
}

export interface AgentAdapter {
  readonly agentType: string
  prepare(worktreePath: string, task: string, sessionId: string): Promise<PtyCommand[]>
}
```

## 5.2 Claude Code 适配器（已实现）

文件：`apps/server/src/agent-adapters/claude.ts`

- [x] 通过 TerminalMultiplexer 启动 `claude` CLI 进程（交互模式）
- [x] Worktree 初始化时自动写入 `.claude/settings.local.json`，注册 Akari HTTP Hook
- [x] 800ms 等待 shell 就绪后发送 `claude\r\n` 启动命令
- [x] 任务文本由用户在 Claude Code 交互界面中自行提交，不再通过命令行参数注入

**注册的 Hook 事件**：

| Hook 事件 | Akari 行为 |
|----------|-----------|
| `SessionStart` | `initializing` → `idle` |
| `UserPromptSubmit` | `paused` / `waiting` / `idle` → `running` |
| `PermissionRequest` | 记录审批日志（当前不阻塞 Claude Code 原生权限流程） |
| `Stop` | `running` / `waiting` → `idle`，广播 `session:lastMessage` |
| `StopFailure` | `running` / `paused` / `waiting` → `failed` |

> **历史说明**：早期版本使用 `--append-system-prompt` 标志注入 Akari 协议，并依赖终端输出 `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 魔法字符串。该方案已在 Phase 8 中废弃，改为 HTTP Hook 单轨驱动。

## 5.3 Aider 适配器（待实现）

文件：`apps/server/src/agent-adapters/aider.ts`

- [ ] 启动 `aider` 进程，配置 `--no-auto-commits`
- [ ] 适配 Aider 输出格式，映射到 Akari HTTP Hook 事件或状态机行为

## 5.4 自定义 Shell 适配器（待实现）

- [ ] `shell` 类型：`createAgentAdapter('shell')` 返回 `null`，PTY 保持纯 shell，用户手动操作
- [ ] 可选：支持用户配置正则 Checkpoint 映射规则（自定义 shell 命令 → Hook 事件）

---

## 验收清单

### AC-1 适配器工厂

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 1.1 | `createAgentAdapter('claude')` | 返回 `ClaudeAdapter` 实例，`agentType === 'claude'` |
| 1.2 | `createAgentAdapter('shell')` | 返回 `null` |
| 1.3 | `createAgentAdapter('aider')` | 返回 `null`（Aider 实现前占位） |
| 1.4 | `createAgentAdapter('unknown')` | 返回 `null`，不抛异常 |

### AC-2 ClaudeAdapter.prepare()

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 2.1 | 返回命令数组长度 | 恰好 1 条命令 |
| 2.2 | 命令内容 | `claude\r\n`（Windows）或 `claude\n`（Unix） |
| 2.3 | 无 delayMs | `delayMs` 为 `undefined` 或 `0` |
| 2.4 | 写入 Hook 配置 | worktree 下生成 `.claude/settings.local.json`，包含 `hooks.PermissionRequest` / `SessionStart` / `Stop` / `StopFailure` / `UserPromptSubmit`，URL 指向 `/sessions/:id/hooks` |
| 2.5 | 重复调用不重复注入 | 同一 worktree 多次 prepare，settings.local.json 中 hook URL 不重复 |

### AC-3 SessionManager 集成

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 3.1 | 创建 `claude` 会话 | 终端内约 800ms 后出现 `claude` 启动命令；Claude Code 启动后触发 `SessionStart` Hook，session 变为 `idle` |
| 3.2 | 创建 `shell` 会话 | 终端内只有 PowerShell 提示符，无任何自动命令 |
| 3.3 | 会话删除后 setTimeout 不触发 | 删除会话后 `hasTerminal(id)` 返回 false，不向已销毁 PTY 写入 |
| 3.4 | `initSession` 异常不阻塞 | adapter.prepare() 抛异常时，session 状态变为 `failed`，错误信息显示在终端 |

### AC-4 HTTP Hook 端到端

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 4.1 | `SessionStart` Hook | session 状态由 `initializing` 变为 `idle` |
| 4.2 | `UserPromptSubmit` Hook | `paused` / `waiting` / `idle` 变为 `running` |
| 4.3 | `Stop` Hook | `running` / `waiting` 变为 `idle`，前端节点消息区更新 `lastAiMessage` |
| 4.4 | `StopFailure` Hook | `running` / `paused` / `waiting` 变为 `failed` |
| 4.5 | `PermissionRequest` Hook | 后端记录日志，session 状态不变 |

---

## 验收步骤

### 前置条件

```bash
# 确认 Claude Code CLI 已安装
claude --version

# 确认项目服务可正常启动
pnpm dev:all
# 前端 http://localhost:5173，后端 http://localhost:3001
```

### Step 1：验证工厂函数（单元级）

在后端源码中临时添加或通过 `tsx` REPL 执行：

```typescript
import { createAgentAdapter } from './src/agent-adapters/index.js'
console.log(createAgentAdapter('claude')?.agentType)  // → 'claude'
console.log(createAgentAdapter('shell'))               // → null
console.log(createAgentAdapter('unknown'))             // → null
```

### Step 2：验证 prepare() 输出

```typescript
import { ClaudeAdapter } from './src/agent-adapters/claude.js'
const adapter = new ClaudeAdapter()
const cmds = await adapter.prepare('/tmp/worktree', '帮我写一个 hello world', 'test-id')
console.log(cmds.length)          // → 1
console.log(cmds[0].cmd)          // → 'claude\r\n' 或 'claude\n'
console.log(cmds[0].delayMs)      // → undefined 或 0

// 验证 settings.local.json 已写入
import { readFile } from 'node:fs/promises'
const settings = JSON.parse(await readFile('/tmp/worktree/.claude/settings.local.json', 'utf8'))
console.log(settings.hooks.SessionStart[0].hooks[0].url)  // → http://localhost:3001/sessions/test-id/hooks
```

### Step 3：验证 Shell 类型会话（无自动命令）

1. 打开前端 → 点击「新建会话」
2. Agent 类型选择 **Shell**，填写任意任务名
3. 会话创建后，进入终端面板
4. **期望**：终端仅显示 PowerShell 提示符（`PS>`），无任何自动注入的命令
5. 手动输入 `echo hello` 验证终端可交互

### Step 4：验证 Claude 自动启动（需已安装 Claude Code CLI）

1. 打开前端 → 点击「新建会话」
2. Agent 类型选择 **Claude**
3. 会话创建后，进入终端面板
4. 观察终端输出时序：
   - **~0.8s**：出现 `claude` 启动命令
   - Claude Code 启动后自动触发 `SessionStart` Hook，前端节点状态变为「空闲中」
5. 如果 claude 未安装，终端会显示 `claude: command not found`（session 进入 `failed`）—— 属于正常降级行为

### Step 5：验证 SessionStart Hook

```powershell
$id = "<SESSION_ID>"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/$id/hooks" `
  -Method POST -ContentType "application/json" `
  -Body '{"hook_event_name":"SessionStart","session_id":"'"$id"'"}'
```

**期望**：命令立即返回 `{}`，前端节点状态由「初始化中」变为「空闲中」。

### Step 6：验证 UserPromptSubmit Hook

```powershell
$id = "<SESSION_ID>"
Invoke-RestMethod -Uri "http://localhost:3001/sessions/$id/hooks" `
  -Method POST -ContentType "application/json" `
  -Body '{"hook_event_name":"UserPromptSubmit","session_id":"'"$id"'"}'
```

**期望**：session 状态由 `paused` / `waiting` / `idle` 变为 `running`。

### Step 7：验证 Stop Hook

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

**期望**：session 状态变为 `idle`，画布节点消息区立即显示新消息。

### Step 8：验证 StopFailure Hook

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

**期望**：节点状态变为「失败」（红色），终端面板出现红色错误行。

### Step 9：验证 PermissionRequest 不阻塞

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

**期望**：命令立即返回 `{}`，session 状态不变，后端日志出现审批记录。

### Step 10：验证删除后 setTimeout 不触发

1. 创建一个 `claude` 类型会话
2. 立即（< 800ms 内）删除该会话
3. 等待 4 秒
4. **期望**：后端日志无报错，无 `write to killed pty` 类错误

---

## 已知限制

| 限制 | 说明 |
|------|------|
| Claude 启动延迟固定 800ms | 若机器较慢，可能 shell 尚未就绪就收到 `claude` 命令；后续可改为检测 PowerShell 提示符动态判断 |
| 任务文本不再自动注入 | 用户需在 Claude Code 交互界面中手动提交任务，首次使用体验需优化 |
| Aider / Shell 适配器未实现 | `shell` 类型等同于纯交互终端；`aider` 选项在工厂中返回 `null`（退化为纯 shell） |
| PermissionRequest 不阻塞 | 当前仅记录日志，统一审批中心尚未生效 |
