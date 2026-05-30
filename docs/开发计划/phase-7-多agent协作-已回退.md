# 阶段七：多 Agent 协作模式（MultiAgent Collaboration）

**状态**：🔲 待开始 | **前置**：阶段一 ～ 六（阶段四/五关键依赖）

---

## 概述与目标

本阶段为 Akari 引入多 Agent 协作能力：多个 Agent 会话可组成有向协作图，相互依赖、传递上下文、动态派生子任务，共同完成超过单 Agent 能力边界的复杂开发任务。

### 核心协作模式

| 模式 | 触发方式 | 典型场景 |
|------|----------|----------|
| **流水线（Pipeline）** | 人工连线：A 完成 → 自动启动 B，并注入 A 的输出摘要 | 写测试 → 写实现 → 写文档 |
| **扇出 / 扇入（Fan-out）** | 人工或 Orchestrator 创建多个并行子任务，全部完成后触发聚合者 | 并行开发多个独立模块 → 汇总 PR |
| **主从 / Orchestrator-Worker** | 用户点击「派生子 Agent」按钮，Agent 以 worker 身份加入同一群组 | Claude Orchestrator 分解大任务后人工确认派发 |
| **同行评审（Peer Review）** | Agent B 订阅 Agent A 的 Diff，完成后写入评审意见并回注 A | 自动 Code Review 闭环 |

### 设计原则

- **图不强迫拓扑**：UI 只允许有向无环图（DAG）；环路在保存前检测并报错
- **上下文显式传递**：父 → 子 / 前驱 → 后继的上下文内容由平台注入，不要求 Agent 自行感知 WS 事件
- **人工保持最终控制**：自动派生的子 Agent 仍走正常审批流程；Orchestrator 无法绕过 `approval-workflow`
- **最小改动原则**：`AgentSession` 新增字段向后兼容，非协作会话的 `collaborationRole` 默认为 `standalone`

---

## 7.1 数据模型扩展

**文件**：`packages/shared-types/src/index.ts`

### 7.1.1 新增类型

```typescript
// 协作群组（多个 session 的逻辑容器）
export interface CollaborationGroup {
  id: string
  name: string
  description?: string
  sessionIds: string[]        // 成员 session ID 列表
  pipelineEdges: PipelineEdge[]
  sharedContext: string       // 共享 Markdown 上下文文档（纯文本）
  status: 'active' | 'completed' | 'failed'
  createdAt: Date
}

// 流水线有向边（A 完成后触发 B）
export interface PipelineEdge {
  id: string
  fromSessionId: string       // 前驱（source）
  toSessionId: string         // 后继（target）
  trigger: 'on-complete' | 'on-checkpoint' | 'on-approval'
  injectContext: boolean       // 是否将前驱 terminalOutput / diff 摘要注入后继任务
  checkpointPattern?: string  // trigger='on-checkpoint' 时匹配的关键字
}

// Agent 间消息记录（用于 UI 展示）
export interface AgentMessage {
  id: string
  fromSessionId: string
  toSessionId: string | 'broadcast'
  content: string
  timestamp: Date
}
```

### 7.1.2 `AgentSession` 扩展字段

```typescript
// 追加到现有 AgentSession interface
collaborationRole: 'standalone' | 'orchestrator' | 'worker' | 'reviewer'
groupId?: string              // 所属 CollaborationGroup.id
parentSessionId?: string      // 派生来源（orchestrator → worker）
childSessionIds: string[]     // 已派生的子 session
pendingContextInject?: string // 流水线触发时等待注入的上下文摘要
```

### 7.1.3 新增 WebSocket 事件

```typescript
// 追加到 ServerMessage union
| { event: 'collaboration:group-created';  payload: CollaborationGroup }
| { event: 'collaboration:group-updated';  payload: CollaborationGroup }
| { event: 'collaboration:agent-spawned';  payload: { groupId: string; parentSessionId: string; newSession: AgentSession } }
| { event: 'collaboration:pipeline-triggered'; payload: { edgeId: string; fromId: string; toId: string } }
| { event: 'collaboration:context-updated'; payload: { groupId: string; context: string } }
| { event: 'agent:message'; payload: AgentMessage }

// 追加到 ClientMessage union
| { event: 'collaboration:create-group';   payload: { name: string; sessionIds: string[] } }
| { event: 'collaboration:add-edge';       payload: { groupId: string; edge: Omit<PipelineEdge, 'id'> } }
| { event: 'collaboration:remove-edge';    payload: { groupId: string; edgeId: string } }
| { event: 'collaboration:update-context'; payload: { groupId: string; context: string } }
```

**验收**：
- [ ] 类型编译通过（`pnpm --filter @akari/shared-types typecheck`）
- [ ] 默认值：`AgentSession.collaborationRole = 'standalone'`，`childSessionIds = []`（非协作会话不受影响）

---

## 7.2 后端：CollaborationManager

**文件**：`apps/server/src/collaboration-manager.ts`

### 7.2.1 数据库 Schema 扩展

```sql
-- 协作群组
CREATE TABLE collaboration_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  shared_context TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

-- 群组成员（多对多）
CREATE TABLE group_sessions (
  group_id    TEXT NOT NULL REFERENCES collaboration_groups(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, session_id)
);

-- 流水线边
CREATE TABLE pipeline_edges (
  id              TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES collaboration_groups(id) ON DELETE CASCADE,
  from_session_id TEXT NOT NULL,
  to_session_id   TEXT NOT NULL,
  trigger         TEXT NOT NULL,   -- 'on-complete' | 'on-checkpoint' | 'on-approval'
  inject_context  INTEGER NOT NULL DEFAULT 1,
  checkpoint_pattern TEXT
);

-- Agent 间消息日志
CREATE TABLE agent_messages (
  id              TEXT PRIMARY KEY,
  from_session_id TEXT NOT NULL,
  to_session_id   TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
```

> `sessions` 表同步新增字段：`collaboration_role`, `group_id`, `parent_session_id`，`child_session_ids`（JSON 数组）

### 7.2.2 CollaborationManager 接口

```typescript
class CollaborationManager {
  // 群组 CRUD
  createGroup(name: string, sessionIds: string[]): CollaborationGroup
  getGroup(groupId: string): CollaborationGroup | undefined
  addSessionToGroup(groupId: string, sessionId: string): void
  removeSessionFromGroup(groupId: string, sessionId: string): void

  // 流水线边管理
  addEdge(groupId: string, edge: Omit<PipelineEdge, 'id'>): PipelineEdge
  removeEdge(groupId: string, edgeId: string): void
  validateDAG(groupId: string): { valid: boolean; cycle?: string[] }  // 环路检测

  // 流水线触发（由 SessionManager 调用）
  onSessionEvent(sessionId: string, event: 'completed' | 'checkpoint' | 'approval', meta?: string): Promise<void>

  // 上下文
  updateSharedContext(groupId: string, context: string): void
  getSharedContext(groupId: string): string

  // Agent 间消息
  routeMessage(from: string, to: string | 'broadcast', content: string): void
  getMessages(groupId: string, limit?: number): AgentMessage[]
}
```

### 7.2.3 流水线触发逻辑

```
onSessionEvent(sessionId, 'completed'):
  1. 查询所有以 sessionId 为 from 的边（trigger='on-complete'）
  2. 对每条边：
     a. injectContext=true → 构造上下文摘要（terminal 最后 50 行 + diffSummary）
     b. 更新目标 session 的 pendingContextInject 字段
     c. 目标 session 状态为 'initializing'（尚未启动）→ 调用 SessionManager.startSession(toId)
        SessionManager.startSession 检测到 pendingContextInject → prepend 到任务描述后注入 Agent
     d. 推送 'collaboration:pipeline-triggered' WS 事件
  3. 检查是否所有"扇入前驱"均已 completed → 触发 fan-in 节点
```

**验收**：
- [ ] `createGroup` / `addEdge` 持久化到 SQLite，服务重启后可恢复
- [ ] `validateDAG` 能检出 A→B→A 的环路并拒绝
- [ ] `on-complete` 触发：Session A 手动改为 `completed` → Session B 自动变 `initializing` 并注入上下文
- [ ] 扇入等待：B、C 均 `completed` 后 D 才触发（B 或 C 单独完成时 D 不触发）

---

## 7.3 多 Agent 协作操作（REST 端点）

所有 Agent 间协作操作均通过 REST 端点触发，**不依赖终端输出检测**。

### 7.3.1 派生子 Agent（Spawn）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/collaboration/spawn` | 派生子 Agent，返回后 WS 推送 `collaboration:agent-spawned` |

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `parentSessionId` | `string` | ✅ | 父 session ID |
| `task` | `string` | ✅ | 子 Agent 任务描述 |
| `agentType` | `AgentType` | 否（默认 claude） | Agent 类型 |
| `branch` | `string` | 否 | 基础分支，默认为父 session 的 baseBranch |

**触发流程**：
1. 后端创建子 session，`collaborationRole = 'worker'`，`parentSessionId` 指向父
2. 更新父的 `childSessionIds` 列表
3. 子 session 自动加入父所在群组（若有）
4. WS 推送 `collaboration:agent-spawned` → 前端自动渲染新节点并打开 Tab

### 7.3.2 消息传递（Delegate）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/collaboration/delegate` | 向另一个 session 终端注入消息 |

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fromSessionId` | `string` | ✅ | 发送方 session ID |
| `toSessionId` | `string` | ✅ | 接收方 session ID |
| `message` | `string` | ✅ | 消息内容 |

**触发流程**：消息内容以青色文字 `\r\n[Message from <fromSessionId>]: <message>\r\n` 注入目标终端，同时 WS 推送 `agent:message`。

### 7.3.3 等待会话完成（Await）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/collaboration/await` | 让当前 session 等待另一个 session 完成 |

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `waitingSessionId` | `string` | ✅ | 等待方 session ID |
| `targetSessionId` | `string` | ✅ | 被等待的 session ID |
| `timeoutSeconds` | `number` | 否（默认 300） | 超时秒数 |

**触发流程**：等待方状态变为 `waiting`；目标 session 完成后，等待方恢复 `running`，终端收到目标 session 的输出摘要；超时后注入 `[TIMEOUT]` 提示并恢复。

---

## 7.4 前端：画布协作视图增强

**文件**：`apps/web/src/components/canvas/`

### 7.4.1 会话间连接边（Pipeline Edge）

- [ ] 使用 `@xyflow/react` 的 `<Edge>` 组件渲染流水线边，箭头方向表示数据流向
- [ ] 边的颜色区分状态：灰色（待触发）/ 蓝色（触发中）/ 绿色（已传递）
- [ ] 悬浮边显示 Tooltip：触发条件（`on-complete` / `on-checkpoint`）+ inject 标志
- [ ] 拖拽节点 Handle 连线 → 弹出"创建流水线边"对话框（选择触发条件 + 是否注入上下文）
- [ ] 删除边：右键边 → 「删除连接」（二次确认 Dialog）

### 7.4.2 群组容器节点（Group Frame）

- [ ] `GroupFrameNode`：框选多个节点自动归为一组，背景色区分不同 group
- [ ] 群组标题可编辑（双击改名）
- [ ] 群组内 session 全部 completed → 框变绿色；任一 failed → 框变红色
- [ ] 从 session 卡片右键菜单添加「加入/移出群组」

### 7.4.3 子 Agent 生成动画

- [ ] Orchestrator 派生子 Agent 时，新节点以"从父节点展开"动画出现（`framer-motion` 或 CSS transition）
- [ ] 父→子之间自动添加虚线边（表示派生关系，不同于流水线触发边）

**验收**：
- [ ] 手动拖线创建 A→B 边 → 数据库持久化，刷新页面边不消失
- [ ] Session A 设为 completed → 触发动画 + Session B 自动进入 initializing 状态
- [ ] 群组框颜色随组内 session 状态实时更新

---

## 7.5 前端：协作管理面板

**文件**：`apps/web/src/components/collaboration/`（新目录）

### 7.5.1 群组状态面板（`GroupDashboard.tsx`）

| 区域 | 内容 |
|------|------|
| 群组列表 | 所有 group 名称 + 成员数 + 整体进度环形图（已完成/运行中/待启动） |
| 成员时间线 | 每个 session 的状态条（按时间轴排列，可见并行/串行结构） |
| 消息流 | Agent 间 `[DELEGATE]` 消息记录，带时间戳和发送方/接收方 |
| 共享上下文 | 可编辑的 Markdown 区域，实时同步到同组所有 Agent |

> 入口：TopNav 新增「协作」按钮（仅有 group 时显示角标）

### 7.5.2 流水线构建向导（`PipelineWizard.tsx`）

- [ ] 步骤 1：从现有 session 列表勾选成员（或创建新 session）
- [ ] 步骤 2：在迷你画布中拖拽连线定义依赖顺序
- [ ] 步骤 3：为每条边配置触发条件 + 上下文注入选项
- [ ] 步骤 4：命名并保存群组

### 7.5.3 创建会话弹窗扩展（`CreateSessionDialog.tsx`）

- [ ] 新增「加入已有群组」下拉（可选）
- [ ] 新增「作为子 Agent 挂载到」下拉（选择 parent session，自动设置 role=worker）
- [ ] 若 parent session 有 `sharedContext`，创建时自动 prepend 到任务描述

**验收**：
- [ ] 从创建向导一步步创建含 2 个并行 session + 1 个汇聚 session 的群组，刷新页面后结构保持
- [ ] 共享上下文编辑后，所有组内 session 的下一次注入任务时均携带该上下文

---

## 7.6 ClaudeAdapter Orchestrator 模式增强

**文件**：`apps/server/src/agent-adapters/claude.ts`

### 7.6.1 Orchestrator System Prompt 注入

当 `collaborationRole === 'orchestrator'` 时，`prepare()` 额外追加以下 system prompt：

```
你是 Akari 协作网络中的 Orchestrator。你负责分解复杂任务并派发给多个 Worker Agent 协同完成。

派生子 Agent 的方式：
- 通过指挥中心（Command Center）或画布节点按钮「派生子 Agent」触发
- 子 Agent 以 worker 身份加入同一协作群组，自动获得父 Agent 的上下文摘要

协作操作（通过 REST 端点或 UI 触发）：
- 派生子 Agent → POST /collaboration/spawn
- 向其他 Agent 发消息 → POST /collaboration/delegate
- 等待其他 Agent 完成 → POST /collaboration/await

规则：
- 分解任务时给 Worker 足够的自主空间，不要过度约束实现方式
- 危险操作必须通过 [APPROVAL_REQUIRED] 流程，不可绕过
```

### 7.6.2 `AgentType` 扩展

```typescript
export type AgentType = 'claude' | 'aider' | 'shell' | 'claude-orchestrator'
```

> `claude-orchestrator` 等同 `claude`，但注入 Orchestrator system prompt，`collaborationRole` 自动设为 `orchestrator`。

**验收**：
- [ ] 创建 `claude-orchestrator` 会话 → system prompt 包含协作说明（不含终端协议标记）
- [ ] Orchestrator session 的 Canvas 节点 hover 显示「派生子 Agent」按钮

---

## 7.7 REST API 扩展

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/collaboration/groups` | 获取所有群组 |
| `POST` | `/collaboration/groups` | 创建群组 |
| `GET` | `/collaboration/groups/:id` | 获取群组详情（含 edges + messages） |
| `PATCH` | `/collaboration/groups/:id` | 更新名称 / 共享上下文 |
| `DELETE` | `/collaboration/groups/:id` | 删除群组（不删除成员 session） |
| `POST` | `/collaboration/groups/:id/edges` | 添加流水线边 |
| `DELETE` | `/collaboration/groups/:groupId/edges/:edgeId` | 删除边 |
| `GET` | `/collaboration/groups/:id/messages` | 获取 Agent 间消息历史 |
| `POST` | `/collaboration/spawn` | 派生子 Agent（手动 UI 触发） |
| `POST` | `/collaboration/delegate` | 向另一个 session 终端注入消息 |
| `POST` | `/collaboration/await` | 让 session 等待另一个 session 完成 |

---

## 验收清单

> **如何阅读**：每条验收项格式为「操作 → 期望 → 判定」。所有判定均在**前后端同时运行**、WebSocket 已连接的前提下进行。

### AC-1 数据模型（7.1）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 1.1 | 非协作会话字段默认值 | 启动后端；POST `/sessions` 创建任意新会话（不传任何协作字段） | `collaborationRole === 'standalone'`，`childSessionIds === []`，`groupId` / `parentSessionId` 为 `undefined` | ✅ 字段符合预期 |
| 1.2 | 共享类型 typecheck | `pnpm --filter @akari/shared-types typecheck` | 0 错误 | ✅ |
| 1.3 | 全栈 typecheck | `pnpm --filter @akari/web typecheck && pnpm --filter @akari/server typecheck` | 0 错误 | ✅ |
| 1.4 | WS 事件类型覆盖 | 搜索 `packages/shared-types/src/index.ts` 中所有 `event` 字面量，确保每条在 `ServerMessage` / `ClientMessage` 中均有定义 | 无悬空事件名 | ✅ |
| 1.5 | 新类型序列化 | POST `/collaboration/groups` 后立即 GET，验证返回 JSON 与 `CollaborationGroup` 接口结构完全一致 | 所有必填字段存在，数组/可选字段符合类型 | ✅ |

### AC-2 流水线触发（7.2 + 7.3）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 2.1 | 创建 on-complete 流水线边 | 1. 创建 Session A 和 Session B<br>2. POST `/collaboration/groups` 创建群组，加入 A、B<br>3. POST `/collaboration/groups/:id/edges` 添加 `{ fromSessionId: A, toSessionId: B, trigger: 'on-complete', injectContext: true }` | 返回 201，edge 已持久化 | |
| 2.2 | A→B 触发 | 保持 A、B 均未启动；将 A 状态 PATCH 为 `completed` | B 在 **5s 内**进入 `initializing` 状态；WS 收到 `collaboration:pipeline-triggered` 事件 | ✅ |
| 2.3 | 上下文注入 | 观察 B 的终端（WS `terminal:data`） | 终端前缀含 `[Context from <A-name>]` 行，随后为 A 的最后 50 行 terminal 输出 | ✅ |
| 2.4 | 扇入等待 | 创建 A、B、C 并行 + D 汇聚（A→D、B→D）；只将 A 置为 `completed` | D **不触发**；等待 B 也 completed 后 D 才进入 `initializing` | ✅ |
| 2.5 | 环路检测拒绝 | 已有 A→B 边；尝试 POST 添加 B→A 边 | HTTP `400`，body 含 `"cycle detected"` | ✅ |
| 2.6 | 服务重启数据恢复 | 触发步骤 2.1 后重启后端；`GET /collaboration/groups/:id` | 群组、A、B 关系、边均完整恢复 | ✅ |
| 2.7 | on-checkpoint 触发 | 添加边 `trigger='on-checkpoint', checkpointPattern='测试完成'`，Agent 终端输出含该关键字 | 目标 session 在输出后 5s 内触发 | ✅ |

### AC-3 协作操作（7.3）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 3.1 | 派生子 Agent（REST） | 点击 Session A 节点的「派生子 Agent」按钮，填写 task 后提交 | 前端自动出现新 Session 卡片，`parentSessionId === A.id`，`collaborationRole === 'worker'`，WS 收到 `collaboration:agent-spawned` | |
| 3.2 | 子 Agent 加入群组 | Session A 在某 group 中；派生子 Agent | 子 session 自动出现在同一 group，画布节点加入 group 边框 | |
| 3.3 | DELEGATE 消息传递 | `POST /collaboration/delegate` { fromSessionId, toSessionId, message } | 目标终端在 **1s 内**收到青色消息，WS 收到 `agent:message` | |
| 3.4 | AWAIT_SESSION 挂起恢复 | `POST /collaboration/await` { waitingSessionId, targetSessionId, timeoutSeconds: 30 } | 等待方状态变为 `waiting`；目标 completed 后，等待方恢复 `running`，终端收到摘要 | |
| 3.5 | AWAIT_SESSION 超时 | 等待中不完成目标，超时 30s 后 | 等待方恢复 `running`，终端显示 `[TIMEOUT] session <id> did not complete` | |

### AC-4 画布视图（7.4）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 4.1 | 拖线创建边 | 在 Canvas 画布上拖拽 Session A 的 handle 到 Session B | 弹出"创建流水线边"对话框；填写后确认 → 边在画布上渲染，持久化到 DB | |
| 4.2 | 边持久化 | 创建边后刷新页面 | 边仍在画布上（GET API 验证 + UI 验证） | ✅ |
| 4.3 | 边颜色状态 | 观察未触发边（A 未 completed）→ 将 A completed → 观察 B 触发 | 触发前：灰色 → 触发时：B 蓝色高亮 + 边变蓝色 → 传递完：绿色 | ✅ |
| 4.4 | 群组框颜色 | 选中多个节点创建群组；将组内任一 session 状态置为 `failed` | 群组框变**红色**；全部 completed → 变**绿色** | ✅ |
| 4.5 | 派生子节点动画 | 点击「派生子 Agent」按钮后（步骤 3.1） | 新节点以展开动画出现，父→子虚线边自动渲染 | ✅ |
| 4.6 | 删除边 | 右键边 → 删除 → 确认 Dialog | 边消失，DB 中记录删除 | ✅ |
| 4.7 | 边 Tooltip | 悬浮边 | 显示触发条件 + inject 标志 | ✅ |

### AC-5 协作面板（7.5）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 5.1 | 群组状态面板入口 | TopNav 有群组时显示「协作」按钮 | 点击打开协作面板 Sheet | |
| 5.2 | 成员状态实时更新 | 面板打开时修改某 session 状态 | 面板内状态条在 **1s 内**更新 | ✅ |
| 5.3 | 消息流记录 | 执行 `POST /collaboration/delegate` 后（步骤 3.3） | 面板消息流区出现记录，含时间戳、发送方、接收方、内容 | ✅ |
| 5.4 | 共享上下文编辑 | 在面板中编辑共享上下文，点击保存 | WS 收到 `collaboration:context-updated`；其他客户端同步 | ✅ |
| 5.5 | 流水线向导 | 点击新建 → 步骤 1 选 session → 步骤 2 拖拽连线 → 步骤 3 配置触发条件 → 步骤 4 保存 | 画布自动出现对应群组和边 | ✅ |
| 5.6 | 新建会话加入群组 | 创建会话时选择「加入已有群组」 | 新 session 自动出现在群组中，画布出现对应节点 | ✅ |

### AC-6 REST API（7.7）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 6.1 | `GET /collaboration/groups` | 调用 API | 返回所有群组数组 | |
| 6.2 | `POST /collaboration/groups` | POST body `{ name: "test", sessionIds: [id1, id2] }` | 返回 201 + 新群组对象 | ✅ |
| 6.3 | `GET /collaboration/groups/:id` | 使用上一步返回的 id | 返回含 `edges` + `sessionIds` 的完整群组 | ✅ |
| 6.4 | `PATCH /collaboration/groups/:id` | PATCH 更新 `name` | 返回更新后的群组，`name` 已变更 | ✅ |
| 6.5 | `DELETE /collaboration/groups/:id` | 删除群组 | 返回 204；GET 返回 404；成员 session **不受影响** | ✅ |
| 6.6 | `POST /collaboration/groups/:id/edges` | 添加边（同 AC-2.1） | 返回 201 + 新 edge（含自动生成的 `id`） | ✅ |
| 6.7 | `DELETE /collaboration/groups/:groupId/edges/:edgeId` | 删除边 | 返回 204；DB 中 edge 已删除 | ✅ |
| 6.8 | `GET /collaboration/groups/:id/messages` | 有 agent 消息后调用 | 返回消息历史数组，按时间升序 | ✅ |

### AC-7 Orchestrator（7.6）

| # | 验收项 | 验证步骤 | 期望结果 | 判定 |
|---|--------|----------|----------|------|
| 7.1 | 创建 orchestrator 会话 | 创建会话，`agentType` 选 `claude-orchestrator` | `collaborationRole === 'orchestrator'` | |
| 7.2 | System prompt 注入 | 查看该 session 的终端初始化输出（`terminal:data` 初始数据） | 包含协作说明（派生子 Agent、DELEGATE、AWAIT 的 REST 端点，不含终端协议标记） | ✅ |
| 7.3 | Orchestrator 派生子 Agent | 点击 Orchestrator 节点的「派生子 Agent」按钮，填写 task 后提交 | 前端出现新 session，`collaborationRole === 'worker'`，`parentSessionId === orchestrator.id`，WS 收到 `collaboration:agent-spawned` | ✅ |

---

## 验收步骤（按执行顺序）

### 预备：环境确认

```bash
# 1. 启动后端 + 前端
pnpm dev:all

# 2. 确认 WS 已连接（TopNav 连接指示灯绿色）
# 3. 确认 devtools Network WS 标签可见 ws://localhost:3001/ws

# 4. 确认数据库存在（首次运行后端会自动创建）
ls apps/server/data/akari.db   # 应存在
```

### Phase 1：数据模型（AC-1，对应里程碑 M7-α 前置）

```
步骤 1：类型检查（终端）
pnpm --filter @akari/shared-types typecheck
pnpm --filter @akari/web typecheck
pnpm --filter @akari/server typecheck
预期：0 错误

步骤 2：创建非协作会话，验证默认值
  - 前端：新建会话（任意名称），不加入任何群组
  - 打开 devtools → Network → WS → 查看 sessions:list 事件 payload
  预期：collaborationRole === 'standalone'，childSessionIds === []，groupId / parentSessionId 为 undefined
```

### Phase 2：基础流水线（M7-α 核心）

> 涉及 UI：Canvas 拖线建边、看板状态操作；涉及 curl：创建群组（群组创建 UI 待实现）

```
步骤 1：创建两个独立会话
  - 新建会话 → 创建 Session-A 和 Session-B（均不启动）

步骤 2：创建群组（curl）
  curl -X POST http://localhost:3001/api/collaboration/groups \
    -H "Content-Type: application/json" \
    -d '{"name":"test-pipeline","sessionIds":["<A-id>","<B-id>"]}'
  （群组创建 UI 完成后可替代此步）

步骤 3：拖线建边（Canvas UI）
  - Session-A 节点 → 鼠标从右侧 handle 拖到 Session-B 左侧 handle
  - 弹出"创建流水线边"对话框
  - 选择触发条件：on-complete；勾选"注入上下文"
  - 确认后边在画布上渲染（灰色虚线表示待触发）

步骤 4：触发流水线
  - 在看板上将 Session-A 拖到"已完成"列
  - 预期：Session-B 在 5s 内变为 initializing（灰色脉冲）
  - 预期：Session-B 终端出现 [Context from A] 上下文注入行

步骤 5：刷新页面
  - F5 刷新 → 边仍在（DB 持久化验证）

步骤 6：验证环路检测（预期拒绝）
  curl -X POST http://localhost:3001/api/collaboration/groups/<groupId>/edges \
    -H "Content-Type: application/json" \
    -d '{"fromSessionId":"<B-id>","toSessionId":"<A-id>","trigger":"on-complete","injectContext":false}'
  预期：HTTP 400，body 含 "cycle"
```

### Phase 3：协作操作（AC-3，对应里程碑 M7-β）

> 涉及 UI：派生子 Agent 按钮、看板操作

```
前置：至少有一个 session 处于 running 状态

步骤 1：派生子 Agent
  - 找到任意 running 节点，hover 鼠标
  - 右上角出现 users 图标按钮 → 点击
  - 弹出 Dialog：填写 task="写单元测试"，agentType 选 Claude Code，branch 保持默认
  - 点击"派发"
  预期：画布上出现新节点（子 Agent），Tab 自动打开，节点显示 worker badge

步骤 2：验证子 Agent 自动加入父群组
  - 若父节点在某个 group 中，子节点自动出现在同一 group（画布边框验证）

步骤 3：DELEGATE 消息传递
  curl -X POST http://localhost:3001/api/collaboration/delegate \
    -H "Content-Type: application/json" \
    -d '{"fromSessionId":"<A-id>","toSessionId":"<B-id>","message":"请检查 lint"}'
  预期：Session-B 终端在 1s 内收到青色 delegation 消息

步骤 4：AWAIT_SESSION
  curl -X POST http://localhost:3001/api/collaboration/await \
    -H "Content-Type: application/json" \
    -d '{"waitingSessionId":"<A-id>","targetSessionId":"<B-id>","timeoutSeconds":30}'
  预期：看板上 Session-A 状态变为 waiting（橙色脉冲）

步骤 5：验证等待恢复
  - 将 Session-B 拖到"已完成"列
  预期：Session-A 在 3s 内恢复 running，终端出现 B 的摘要

步骤 6：验证超时
  - 重复步骤 4（等待一个不会完成的 session）
  - 等待 30s
  预期：终端出现 [TIMEOUT] 提示，状态恢复 running
```

### Phase 4：画布视图（AC-4，对应里程碑 M7-γ）

> 所有操作在前端 Canvas 画布进行

```
步骤 1：拖线创建边
  - 两个 session 节点 → 从 source handle（右侧圆球）拖到 target handle（左侧圆球）
  - 弹出"创建流水线边"对话框
  - 选择触发条件、勾选是否注入上下文 → 确认

步骤 2：刷新页面
  - F5 刷新 → 边仍在画布上（DB 持久化验证）

步骤 3：观察边状态变化
  - 触发前：灰色
  - 触发时：边 + 目标节点高亮蓝色
  - 传递完：绿色

步骤 4：创建群组框
  - 框选多个节点 → 右键 → 「创建群组」
  - 验证框出现；组内状态影响框颜色

步骤 5：派生子节点
  - 点击 Orchestrator 节点的 users 按钮（复用 Phase 3 步骤 1）
  - 观察新节点以展开动画出现，父→子虚线边自动渲染
```

### Phase 5：协作面板（AC-5）

> 所有操作在协作面板 Sheet（右侧抽屉）进行

```
步骤 1：打开协作面板
  - TopNav「协作」按钮 → 右侧 Sheet 打开

步骤 2：查看成员状态实时更新
  - 面板打开时，在看板上修改某 session 状态
  - 面板内状态条在 1s 内更新

步骤 3：发送 DELEGATE 消息
  - 面板消息流区 → 找到发送 DELEGATE 入口（或直接用 curl，参考 Phase 3 步骤 3）
  预期：面板消息流区出现记录，含时间戳、发送方、接收方、内容

步骤 4：编辑共享上下文
  - 面板中找到「共享上下文」区域
  - 编辑 Markdown 内容 → 点击保存
  预期：WS 收到 collaboration:context-updated；其他客户端同步

步骤 5：流水线向导
  - 点击「新建流水线」→「按向导操作」
  - 步骤 1 选 session → 步骤 2 拖拽连线 → 步骤 3 配置触发条件 → 步骤 4 保存
  预期：画布自动出现对应群组和边
```

### Phase 6：Orchestrator 端到端（M7-β → M7）

```
步骤 1：创建 Orchestrator 会话
  - 新建会话 → agentType 选择「Claude Orchestrator」
  - 验证看板/画布上节点显示 Orchestrator badge

步骤 2：验证 System Prompt 注入
  - 打开该会话终端 → 滚到顶部
  预期：包含协作说明（派生子 Agent → POST /collaboration/spawn，DELEGATE → POST /collaboration/delegate，AWAIT → POST /collaboration/await）
  预期：不包含 [SPAWN_AGENT] / [DELEGATE] 等终端协议标记

步骤 3：派生子 Agent（UI 触发）
  - Orchestrator 节点 hover → users 按钮 → 弹出 Dialog
  预期：前端出现新 session，collaborationRole === 'worker'，parentSessionId 指向 orchestrator
```

### 清理验收数据

```
步骤 1：删除测试群组
  - 协作面板 → 找到测试群组 → 点击删除按钮
  或 curl：
curl -X DELETE http://localhost:3001/api/collaboration/groups/<test-group-id>

步骤 2：删除测试 session
  - 画布上选中测试节点 → hover 右上角删除按钮 → 确认 Dialog
  或 curl：
curl -X DELETE http://localhost:3001/api/sessions/<test-session-id>
```

---

## 里程碑

| 里程碑 | 内容 | 完成条件 | 状态 |
|--------|------|----------|------|
| **M7-α** | 数据模型 + 流水线触发（7.1 + 7.2） | AC-1 ✅ + AC-2 ✅ | 🔲 |
| **M7-β** | 协议标记 + Orchestrator（7.3 + 7.6） | AC-3 ✅ + AC-7 ✅ | 🔲 |
| **M7-γ** | 画布视图 + 协作面板（7.4 + 7.5） | AC-4 ✅ + AC-5 ✅ | 🔲 |
| **M7-δ** | REST API 完整（7.7） | AC-6 ✅ | 🔲 |
| **M7** | 完整协作模式端到端可用 | M7-α + M7-β + M7-γ + M7-δ 全部 ✅ | 🔲 |

> **里程碑完成标准**：每个里程碑需通过该里程碑对应的所有 AC（判定列全为 ✅），方可标记为完成并进入下一里程碑。

---

## 技术风险与决策点

| 风险 | 影响 | 预案 |
|------|------|------|
| 扇入等待逻辑中若某个 session 永久 `running`（Agent 卡死）| Fan-in 群组无法触发 | `AWAIT_SESSION` 默认 5 分钟超时；协作面板显示"等待中"状态 + 手动强制触发按钮 |
| Canvas 边数量过多导致 @xyflow/react 渲染性能下降 | >20 个 session 的大型协作图 | 超过阈值时隐藏边 Label，提供 Minimap；M7-γ 后评估 |
| SQLite 并发写入（多 session 同时触发流水线）| 数据竞争 | better-sqlite3 已是单线程同步；CollaborationManager 方法加排队锁（`async-mutex`）|

---

## 附录：前端 ASCII 原型

### TopNav（已有协作组时显示角标）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [A] Akari  │ [画布] [看板] │  feat/auth ×  feat/db ×  │  ●2  ⏸1  ◉  [🔗协作²] [指挥中心] [+新建] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 画布视图（含 Pipeline 连线 + 派生关系）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   ┌──────────────────┐                  ┌──────────────────┐                │
│   │ 🔵 orchestrator   │                  │ 🟡 feat/db        │                │
│   │ claude-orch      │ ─────────────►   │ claude           │                │
│   │ ████████░░ 80%   │  on-complete     │ ░░░░░░░░░░  0%   │                │
│   │ running          │  [inject ctx]    │ waiting          │                │
│   └──────────────────┘                  └──────────────────┘                │
│           │                                      │                           │
│     spawned (- - -)                        spawned (- - -)                  │
│           │                                      │                           │
│           ▼                                      ▼                           │
│   ┌──────────────────┐                  ┌──────────────────┐                │
│   │ 🟢 feat/auth      │                  │ 🔴 feat/tests     │                │
│   │ claude           │                  │ claude           │                │
│   │ ████████████ 92% │                  │ ░░░░░░░░░░  0%   │                │
│   │ running          │                  │ failed           │                │
│   └──────────────────┘                  └──────────────────┘                │
│                                                                              │
│  [+] [Controls]           拖拽节点之间连线 = 创建 Pipeline 边                 │
└─────────────────────────────────────────────────────────────────────────────┘

  ── 实线箭头（紫色）= Pipeline 边（on-complete / on-checkpoint）
  -- 虚线箭头（灰色）= 派生关系（「派生子 Agent」按钮触发）
```

### 协作面板 Sheet（右侧抽屉）

```
                                          ┌────────────────────────────────┐
                                          │ 🔗 多 Agent 协作            [↻] │
                                          ├────────────────────────────────┤
                                          │                                │
                                          │ ▼ auth-db pipeline     [×删除] │
                                          │ ┌──────────────────────────┐  │
                                          │ │ auth-db pipeline  ●active │  │
                                          │ │ "orchestrator → workers"  │  │
                                          │ │                           │  │
                                          │ │ 成员 (3)                  │  │
                                          │ │ [orchestrator] [auth] [db]│  │
                                          │ │                           │  │
                                          │ │ Pipeline (2)              │  │
                                          │ │ orch → auth  [完成时触发] │  │
                                          │ │              [注入] [×]   │  │
                                          │ │ orch → db    [完成时触发] │  │
                                          │ │              [注入] [×]   │  │
                                          │ │                           │  │
                                          │ │ 共享上下文                │  │
                                          │ │ ┌───────────────────────┐ │  │
                                          │ │ │ 项目使用 TypeScript,  │ │  │
                                          │ │ │ Fastify, SQLite...    │ │  │
                                          │ │ └───────────────────────┘ │  │
                                          │ │                [💾 保存]  │  │
                                          │ └──────────────────────────┘  │
                                          │                                │
                                          │ ► 扇入示例（折叠）             │
                                          │                                │
                                          ├────────────────────────────────┤
                                          │ 💡 画布拖拽连线创建 Pipeline   │
                                          │    「派生子 Agent」按钮可动态派生   │
                                          └────────────────────────────────┘
```

### 新建会话对话框（新增 claude-orchestrator 选项）

```
┌──────────────────────────────────────┐
│ ✨ 新建会话                           │
├──────────────────────────────────────┤
│ 会话名称                              │
│ ┌────────────────────────────────┐   │
│ │ feat/user-auth                 │   │
│ └────────────────────────────────┘   │
│ 任务描述                              │
│ ┌────────────────────────────────┐   │
│ │ 实现用户认证模块，包括...        │   │
│ └────────────────────────────────┘   │
│ 基础分支          Agent 类型          │
│ ┌────────────┐  ┌─────────────────┐  │
│ │ main    ▾  │  │ Claude Orch.  ▾ │  │
│ └────────────┘  │─────────────────│  │
│                 │ Claude Code     │  │
│                 │ Claude Orch. ◀  │  │  ← 新增
│                 │ Aider           │  │
│                 │ Shell（自定义）  │  │
│                 └─────────────────┘  │
│              [取消]  [+ 创建会话]     │
└──────────────────────────────────────┘
```

### 数据流总览

```
用户拖拽画布连线
      │
      ▼
CanvasView.onConnect()
      ├─► POST /collaboration/groups        （找不到共同 group 时自动创建）
      └─► POST /collaboration/groups/:id/edges
              │
              ▼
         fetchGroups() → store.groups 更新
              │
              ▼
         useEffect → setEdges() → ReactFlow 渲染连线

WebSocket 实时事件：
  collaboration:group-created    → store.groups 插入
  collaboration:group-updated    → store.groups 更新
  collaboration:group-deleted    → store.groups 删除
  collaboration:agent-spawned    → store.sessions 插入 + openTab + toast
  collaboration:pipeline-triggered → toast 通知
  collaboration:context-updated  → store.groups[].sharedContext 更新
  agent:message                  → terminalBus 注入青色文字到对应终端
```
