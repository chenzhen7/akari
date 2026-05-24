# 阶段五：Agent 适配层

**状态**：� 进行中（Claude ✅ 已实现，Aider / Shell 🔲 待实现） | **前置**：阶段二 + 阶段三

---

## 5.1 适配器接口（已实现）

文件：`apps/server/src/agent-adapters/base.ts`

> 与原设计略有差异：采用"PTY 命令序列"模式代替生命周期方法，
> 因为 Agent 进程直接运行在已有的 PTY shell 中，无需独立的 pause/resume 控制。

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
- [x] 注入 Akari 协议 system prompt（`--append-system-prompt` 标志，单行无特殊字符）
- [x] 800ms 等待 shell 就绪，2500ms 等待 Claude UI 加载后自动注入任务文本
- [x] 任务文本换行符归一化（多行任务折叠为单行，防止提前提交）
- [x] `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 由 TerminalMux 统一检测（无需适配器重复解析）

**System Prompt 注入的 Akari 协议内容：**
```
(1) CHECKPOINT：每完成一个重要步骤，输出 [CHECKPOINT] description
(2) APPROVAL REQUIRED：执行破坏性操作前，输出 [APPROVAL_REQUIRED] type=destructive-op command=CMD
    然后停止等待，用户回复 y 继续，n 跳过
(3) MERGE READY：所有工作完成后，输出 [APPROVAL_REQUIRED] type=merge-ready 并等待合并审批
```

## 5.3 Aider 适配器（待实现）

文件：`apps/server/src/agent-adapters/aider.ts`

- [ ] 启动 `aider` 进程，配置 `--no-auto-commits`
- [ ] 适配 Aider 输出格式，映射到统一的 `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 协议

## 5.4 自定义 Shell 适配器（待实现）

- [ ] `shell` 类型：`createAgentAdapter('shell')` 返回 `null`，PTY 保持纯 shell，用户手动操作
- [ ] 可选：支持用户配置正则 Checkpoint 映射规则（自定义 shell 命令 → checkpoint 协议）

---

## Checkpoint 标记格式（终端输出规范）

```
[CHECKPOINT] <描述>
[APPROVAL_REQUIRED] type=destructive-op command="<命令>"   ← 引号可省略
[APPROVAL_REQUIRED] type=destructive-op command=<命令>     ← 无引号也支持
[APPROVAL_REQUIRED] type=merge-ready
```

> **TerminalMux 解析规则**（`terminal-mux.ts detectMarkers()`）：
> `command=` 后依次尝试双引号、单引号、无引号（取行尾），三种格式均可识别。

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
| 2.1 | 返回命令数组长度 | 恰好 2 条命令 |
| 2.2 | 第一条命令 | 包含 `claude --append-system-prompt` 且无 `delayMs` / `delayMs=0` |
| 2.3 | 第二条命令 | 包含任务文本，`delayMs === 2500` |
| 2.4 | 任务含换行符 | 换行符被替换为空格，单条命令发出 |
| 2.5 | System prompt 无双引号 | `--append-system-prompt "..."` 中的值不含 `"` |
| 2.6 | `prepare()` 不修改 worktree 文件 | 调用前后 worktree 目录内容无变化 |

### AC-3 SessionManager 集成

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 3.1 | 创建 `claude` 会话 | 终端内约 800ms 后出现 `claude` 启动命令；约 3300ms 后出现任务文本 |
| 3.2 | 创建 `shell` 会话 | 终端内只有 PowerShell 提示符，无任何自动命令 |
| 3.3 | 会话删除后 setTimeout 不触发 | 删除会话后 `hasTerminal(id)` 返回 false，不向已销毁 PTY 写入 |
| 3.4 | `initSession` 异常不阻塞 | adapter.prepare() 抛异常时，session 状态变为 `failed`，错误信息显示在终端 |

### AC-4 Checkpoint 协议端到端

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 4.1 | 终端输出 `[CHECKPOINT] step done` | `checkpoint:reached` WS 事件推送，前端进度更新 |
| 4.2 | 终端输出 `[APPROVAL_REQUIRED] type=destructive-op command=rm -rf /tmp/x` | `approval:required` 事件推送，session 状态变 `waiting` |
| 4.3 | 终端输出 `[APPROVAL_REQUIRED] type=destructive-op command="rm -rf /tmp/x"` | 同上，带引号格式也能识别 |
| 4.4 | 终端输出 `[APPROVAL_REQUIRED] type=merge-ready` | `approval:required` 事件推送，`request.type === 'merge-ready'` |
| 4.5 | 用户批准后 | `y\n` 发送到终端，session 变 `running` |
| 4.6 | 用户拒绝后 | `n\n` 发送到终端，session 变 `paused` |

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
console.log(cmds.length)          // → 2
console.log(cmds[0].cmd)          // 含 'claude --append-system-prompt'
console.log(cmds[0].delayMs)      // → undefined（无额外延迟）
console.log(cmds[1].delayMs)      // → 2500
console.log(cmds[1].cmd)          // → '帮我写一个 hello world\r\n'

// 验证多行任务归一化
const cmds2 = await adapter.prepare('/tmp', '第一步\n第二步\n第三步', 'test-id')
console.log(cmds2[1].cmd)         // → '第一步 第二步 第三步\r\n'
```

### Step 3：验证 Shell 类型会话（无自动命令）

1. 打开前端 → 点击「新建会话」
2. Agent 类型选择 **Shell**，填写任意任务名
3. 会话创建后，进入终端面板
4. **期望**：终端仅显示 PowerShell 提示符（`PS>`），无任何自动注入的命令
5. 手动输入 `echo hello` 验证终端可交互

### Step 4：验证 Claude 自动启动（需已安装 Claude Code CLI）

1. 打开前端 → 点击「新建会话」
2. Agent 类型选择 **Claude**，任务填写 `请创建一个名为 hello.txt 的文件，内容为 Hello Akari`
3. 会话创建后，进入终端面板
4. 观察终端输出时序：
   - **~0.8s**：出现 `claude --append-system-prompt "..."` 被执行
   - **~3.3s**：出现任务文本被输入到 Claude
   - Claude 启动并开始处理任务
5. 如果 claude 未安装，终端会显示 `claude: command not found`（session 进入 `failed`）—— 属于正常降级行为

### Step 5：验证 Checkpoint 事件

在任意活跃 session 的终端中手动输入：

```
Write-Output "[CHECKPOINT] 测试进度汇报"
```

**期望**：
- 前端画布节点 / 看板卡片上进度文字更新
- 浏览器 DevTools → Network → WS 帧中出现 `checkpoint:reached` 事件

### Step 6：验证 Approval 流程

在任意活跃 session 的终端中手动输入：

```
Write-Output "[APPROVAL_REQUIRED] type=destructive-op command=del /tmp/test.txt"
```

**期望**：
1. Session 状态变为 `waiting`（画布节点变色 / 看板列变更）
2. WS 帧中出现 `approval:required` 事件，`command === 'del /tmp/test.txt'`
3. 通过 REST API 审批：
   ```bash
   curl -X POST http://localhost:3001/sessions/<id>/approval \
     -H "Content-Type: application/json" \
     -d '{"decision":"approved"}'
   ```
4. 终端收到 `y\n`，session 状态恢复 `running`

重复上述步骤，`decision` 改为 `rejected`，验证 session 变 `paused`，终端收到 `n\n`。

### Step 7：验证 merge-ready 审批

```
Write-Output "[APPROVAL_REQUIRED] type=merge-ready"
```

**期望**：`approval:required` 事件中 `request.type === 'merge-ready'`，流程与 Step 6 相同。

### Step 8：验证删除后 setTimeout 不触发

1. 创建一个 `claude` 类型会话
2. 立即（< 800ms 内）删除该会话
3. 等待 4 秒
4. **期望**：后端日志无报错，无 `write to killed pty` 类错误

---

## 已知限制

| 限制 | 说明 |
|------|------|
| Claude 启动延迟为固定 2500ms | 若机器较慢或网络需验证 API Key，Claude 可能尚未就绪就收到任务文本；后续可改为检测 Claude 输出特征（如 `>` 提示符）来动态判断就绪 |
| `--append-system-prompt` 依赖 CLI 版本 | 需 Claude Code CLI 支持该标志；若不支持会在终端显示错误，session 进入 `failed` |
| 多行任务归一化丢失换行 | 任务中的换行被替换为空格，对结构化任务描述有轻微影响；后续可考虑拆分为多条消息发送 |
| Aider / Shell 适配器未实现 | `shell` 类型等同于纯交互终端；`aider` 选项在工厂中返回 `null`（退化为纯 shell） |
