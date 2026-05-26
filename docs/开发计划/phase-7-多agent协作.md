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
| **主从 / Orchestrator-Worker** | Orchestrator Agent 通过 `[SPAWN_AGENT]` 协议动态派生子 Agent | Claude 分解大任务后自动分配 |
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

## 7.3 多 Agent 通信协议扩展

**文件**：`apps/server/src/terminal-mux.ts`（扩展 `detectMarkers`）

### 7.3.1 新增协议标记

```
# Orchestrator 动态派生子 Agent
[SPAWN_AGENT] task="<任务描述>" agentType="claude|aider|shell" branch="<可选基础分支>"

# 向另一个 session 发送消息（注入其终端）
[DELEGATE] sessionId="<id>" message="<消息内容>"

# 声明当前任务完成，附带摘要供流水线后继使用
[TASK_DONE] summary="<摘要文字>"

# 请求等待某个 session 完成（阻塞式，平台注入等待结果后通知）
[AWAIT_SESSION] sessionId="<id>" timeoutSeconds=300
```

### 7.3.2 TerminalMux 解析逻辑

```
detectMarkers(line) 中新增：

SPAWN_AGENT:
  → 解析 task / agentType / branch 字段
  → 推送 WS 事件 server:spawn-request（SessionManager 接收后创建子 session）
  → 子 session 自动加入父 session 所属 group

DELEGATE:
  → 解析 sessionId / message
  → CollaborationManager.routeMessage(currentSessionId, sessionId, message)
  → 通过 TerminalMux.writeToTerminal(sessionId, message + '\r\n') 注入目标终端

TASK_DONE:
  → 保存 summary 到 session.diffSummary（覆盖 git diff summary）
  → 触发 CollaborationManager.onSessionEvent(id, 'completed')

AWAIT_SESSION:
  → 将当前 session 挂起（状态 → 'waiting'）
  → 注册等待回调：目标 session completed → 将目标 terminalOutput 尾部注入当前终端 → 恢复 running
  → timeout 到期仍未完成 → 注入 "[TIMEOUT] session <id> did not complete" → 恢复 running
```

> `[SPAWN_AGENT]` / `[DELEGATE]` 均**不触发 `approval:required`**，但 Orchestrator 派生的子 session 仍需经过正常审批流程。

**验收**：
- [ ] 手动在终端输出 `[SPAWN_AGENT] task="写单元测试" agentType="claude"` → 前端自动出现新 session 卡片，且 `parentSessionId` 指向当前 session
- [ ] `[DELEGATE] sessionId="xxx" message="请修复 lint 错误"` → 目标终端收到该消息
- [ ] `[AWAIT_SESSION]` 挂起后，目标 session 完成 → 当前 session 自动恢复并收到摘要

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
你是 Akari 协作网络中的 Orchestrator。你可以使用以下协议派生子 Agent：

[SPAWN_AGENT] task="<任务>" agentType="claude"
  → 系统将自动创建新 Agent 并启动

[DELEGATE] sessionId="<id>" message="<消息>"
  → 向指定 Agent 的终端发送消息

[AWAIT_SESSION] sessionId="<id>" timeoutSeconds=300
  → 暂停并等待指定 Agent 完成后继续

[TASK_DONE] summary="<摘要>"
  → 声明所有子任务已汇总完毕

规则：
- 派生子 Agent 时不要包含过多实现细节，给 Agent 足够自主空间
- 危险操作仍须通过 [APPROVAL_REQUIRED] 流程，不可绕过
```

### 7.6.2 `AgentType` 扩展

```typescript
export type AgentType = 'claude' | 'aider' | 'shell' | 'claude-orchestrator'
```

> `claude-orchestrator` 等同 `claude`，但注入 Orchestrator system prompt，`collaborationRole` 自动设为 `orchestrator`。

**验收**：
- [ ] 创建 `claude-orchestrator` 会话 → system prompt 包含协作协议
- [ ] Orchestrator 输出 `[SPAWN_AGENT]` → 前端新增 worker session，`parentSessionId` 正确关联

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

---

## 验收清单

### AC-1 数据模型（7.1）

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 1.1 | 非协作会话 `collaborationRole` | `'standalone'`，其余新增字段均有默认值，不影响现有功能 |
| 1.2 | 共享类型 typecheck | `pnpm --filter @akari/shared-types typecheck` 0 错误 |
| 1.3 | 全栈 typecheck | `pnpm --filter @akari/web typecheck && pnpm --filter @akari/server typecheck` 0 错误 |

### AC-2 流水线触发（7.2 + 7.3）

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 2.1 | A→B `on-complete` 边 | 将 A 状态置为 `completed` → B 在 2s 内进入 `initializing` |
| 2.2 | 上下文注入 | B 的终端收到 A 的 terminalOutput 尾部（前缀 `[Context from A]`） |
| 2.3 | 扇入等待 | B、C 均 `completed` 后 D 才触发；单独 B 完成时 D 不触发 |
| 2.4 | 环路检测 | 尝试添加 B→A 边（已有 A→B）→ API 返回 `400 cycle detected` |
| 2.5 | 服务重启 | 重启后端 → 群组、边、session 关系完整恢复 |

### AC-3 协议标记（7.3）

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 3.1 | `[SPAWN_AGENT]` | 新 session 出现，`parentSessionId` 指向当前 session |
| 3.2 | `[DELEGATE]` | 目标终端在 500ms 内收到消息 |
| 3.3 | `[AWAIT_SESSION]` | 当前 session 状态变 `waiting`；目标完成后恢复 `running` 并收到摘要 |
| 3.4 | `[AWAIT_SESSION]` timeout | 超时后当前 session 恢复 `running`，终端显示 timeout 提示 |

### AC-4 画布视图（7.4）

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 4.1 | 拖线创建边 | 边持久化，刷新页面保持 |
| 4.2 | 边颜色状态 | 触发前灰色 → 触发时蓝色 → 传递完绿色 |
| 4.3 | 群组框颜色 | 组内全部 completed → 绿框；任一 failed → 红框 |
| 4.4 | 派生子节点 | 新节点以动画方式出现，虚线连接父节点 |

### AC-5 协作面板（7.5）

| # | 验收项 | 期望结果 |
|---|--------|----------|
| 5.1 | 群组状态面板 | 成员状态、消息流、共享上下文实时更新 |
| 5.2 | 共享上下文编辑 | 编辑后 200ms 内 WS 广播到前端；下一次注入任务时携带 |
| 5.3 | 流水线向导 | 3 步创建含依赖关系的群组，画布自动出现对应连线 |

---

## 里程碑

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| **M7-α** | 数据模型 + 流水线触发（7.1 + 7.2） | 🔲 |
| **M7-β** | 协议标记 + Orchestrator（7.3 + 7.6） | 🔲 |
| **M7-γ** | 画布视图 + 协作面板（7.4 + 7.5） | 🔲 |
| **M7** | 完整协作模式端到端可用 | 🔲 |

---

## 技术风险与决策点

| 风险 | 影响 | 预案 |
|------|------|------|
| `[SPAWN_AGENT]` 协议依赖 Claude 输出格式，实际 LLM 可能格式不稳定 | Orchestrator 模式可靠性 | 前端保留手动"添加子 Agent"操作；协议仅作加速手段 |
| 扇入等待逻辑中若某个 session 永久 `running`（Agent 卡死）| Fan-in 群组无法触发 | `AWAIT_SESSION` 默认 5 分钟超时；群组面板显示"等待中"状态 + 手动强制触发按钮 |
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
  -- 虚线箭头（灰色）= 派生关系（[SPAWN_AGENT] 自动生成）
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
                                          │    [SPAWN_AGENT] 可动态派生   │
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
