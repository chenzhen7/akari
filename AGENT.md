# AGENT.md

本文件为 AI Coding Agent（Windsurf Cascade、Claude Code 等）提供在本仓库工作的上下文。

> **接手前必读**：[docs/progress.md](docs/progress.md) — 当前开发进度快照，含已完成模块、正在进行的任务和前置依赖关系。

---

## 项目概述

**Akari** 是一个 AI Agent 并行开发管理平台。完整产品架构见 [docs/设计文档.md](docs/设计文档.md)，开发计划见 [docs/开发计划.md](docs/开发计划.md)。

**当前状态（阶段一已完成）**：
- Monorepo 改造完成（pnpm workspaces）
- 后端 Fastify 骨架已运行（port 3001，WebSocket + REST）
- 前端已迁移至 `apps/web/`，通过 WebSocket 与后端实时通信
- Session Store 由 WebSocket 事件驱动，TopNav 显示连接状态指示灯

**核心理念：「指挥中心」模式**
- 用户是指挥官，Agent 是并行执行的士兵
- 无限画布 = 战场全局视图
- 看板 = 任务状态流转
- Tab = 快速聚焦单个战场
- Worktree = 物理隔离的并行战线

---

## 技术栈

```
前端 (apps/web): React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
画布: @xyflow/react
看板: @dnd-kit/core
终端: xterm.js（待接入）
状态: Zustand
Diff: Monaco Editor（待接入）

后端 (apps/server): Node.js + Fastify 5 + @fastify/websocket
终端复用: node-pty（待实现）
Git 操作: simple-git（待实现）
文件监听: chokidar（待实现）
通信: WebSocket（ws://localhost:3001/ws）
数据库: SQLite - better-sqlite3（待实现）

共享类型: packages/shared-types（workspace:*）
```

---

## 项目结构（当前实际）

```
akari/
├── apps/
│   ├── server/                        # ✅ 后端 Fastify 服务
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts               # 入口，端口 3001（REST + WebSocket）
│   └── web/                           # ✅ 前端（已从根 src/ 迁移）
│       ├── package.json
│       ├── vite.config.ts             # 含 /api 和 /ws 反向代理
│       ├── tsconfig.json / app / node
│       ├── index.html
│       └── src/
│           ├── types/index.ts         # 重新导出 @akari/shared-types
│           ├── stores/session-store.ts  # WebSocket 驱动，含 handleServerMessage
│           ├── hooks/
│           │   └── useWebSocket.ts    # ✅ 连接管理 + 自动重连（指数退避）
│           ├── components/
│           │   ├── canvas/            # CanvasView + SessionNode
│           │   ├── kanban/            # KanbanView + KanbanCard + KanbanColumn
│           │   ├── session/           # SessionDetail + TaskPanel + TerminalPanel
│           │   ├── command-center/    # CommandCenter（广播调后端 API）
│           │   ├── create-session/    # CreateSessionDialog（含 agentType 选择）
│           │   ├── layout/            # AppShell（初始化 WS）+ TopNav（连接指示灯）
│           │   └── ui/                # shadcn/ui 组件
│           └── lib/utils.ts
├── packages/
│   └── shared-types/                  # ✅ 前后端共享类型包
│       ├── package.json
│       └── src/
│           └── index.ts               # AgentSession / ServerMessage / ClientMessage 等
├── docs/
│   ├── 设计文档.md
│   ├── 开发计划.md
│   └── progress.md                    # 进度快照（每次完成阶段后更新）
├── pnpm-workspace.yaml
├── package.json                       # workspace root，含 dev:all / typecheck 脚本
├── AGENT.md / CLAUDE.md               # AI Agent 上下文（内容相同）
└── docs/                              # 见文档索引
```

---

## 启动方式

```bash
# 安装依赖（首次或新增包后）
pnpm install

# 开发模式：同时启动前端 + 后端
pnpm dev:all

# 单独启动
pnpm --filter @akari/server dev   # 后端 http://localhost:3001
pnpm --filter @akari/web   dev   # 前端 http://localhost:5173

# 类型检查
pnpm --filter @akari/web    typecheck
pnpm --filter @akari/server typecheck
```

---

## 已实现的后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/sessions` | 获取所有会话 |
| POST | `/sessions` | 创建新会话（body: `{name, task, baseBranch, agentType}`） |
| PATCH | `/sessions/:id/status` | 更新会话状态（body: `{status}`，含状态机校验） |
| POST | `/sessions/:id/approval` | 审批决策（body: `{decision: 'approved'|'rejected'}`） |
| POST | `/broadcast` | 广播消息（body: `{message, targets?}`） |
| GET | `/ws` | WebSocket 端点（`ws://localhost:3001/ws`） |

---

## WebSocket 事件协议

前后端通过以下事件通信（严格遵守字段名）：

| 事件名 | 方向 | 关键 Payload 字段 |
|--------|------|-------------------|
| `sessions:list` | S→C | `payload: AgentSession[]`（连接时立即推送） |
| `session:created` | S→C | `payload: AgentSession` |
| `session:updated` | S→C | `payload: AgentSession`（全量更新） |
| `session:status` | S→C | `payload: {id, status, progress}` |
| `terminal:data` | S→C | `payload: {sessionId, data: string}` |
| `terminal:input` | C→S | `payload: {sessionId, data: string}` |
| `diff:update` | S→C | `payload: {sessionId, diff: GitDiff}` |
| `approval:required` | S→C | `payload: {sessionId, request: ApprovalRequest}` |
| `approval:decision` | C→S | `payload: {sessionId, decision: 'approved'\|'rejected'}` |
| `checkpoint:reached` | S→C | `payload: {sessionId, description: string}` |
| `broadcast:send` | C→S | `payload: {message: string, targets?: string[]}` |

---

## 编码规范

### TypeScript
- 严格模式（`strict: true`）
- 所有公共 API 必须显式标注返回类型
- 优先使用 `interface` 定义对象类型
- 禁止 `as` 断言，使用类型守卫

### React
- 函数组件 + Hooks
- Props 解构，命名：`ComponentNameProps`
- 状态管理用 Zustand，避免深层 prop drilling
- 副作用集中放在自定义 Hooks

### 命名约定
- 文件：PascalCase（组件），camelCase（工具），kebab-case（配置）
- 变量：camelCase；常量：UPPER_SNAKE_CASE；类型：PascalCase
- CSS：Tailwind 优先，复杂样式用 `cn()` 工具函数

### UI 交互规范
**确认弹窗**
- 所有需要二次确认的破坏性操作，统一使用 shadcn/ui `<Dialog>` 组件，**禁止使用内联 `confirmXxx` 状态 

**定位 Bug 的纪律**
- 找到根本原因前，不提交补丁；找到后，**回滚所有错误方向的补丁**，再应用最小化正确修复
---

## Agent 集成协议

实现 Agent 适配器时必须支持：

```typescript
interface AgentAdapter {
  start(task: string, cwd: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  sendMessage(msg: string): Promise<void>;
  onCheckpoint(callback: CheckpointHandler): void;
}
```

**Checkpoint 标记约定**（通过终端输出解析）：
```
[CHECKPOINT] <描述>
[APPROVAL_REQUIRED] type=destructive command="<命令>"
[APPROVAL_REQUIRED] type=merge-ready
```

---

## Worktree 管理规范

- Worktree 基础目录：`<repo>/.agent-worktrees/<sessionId>/`
- 分支命名：`agent/<taskName>-<sessionId前8位>`
- 依赖隔离：通过符号链接复用 `node_modules`
- 清理：会话结束后必须调用 `removeWorktree()`

---

## 核心实现原则（禁止违反）

1. **物理隔离优先**：每个 Agent 会话使用独立 worktree，禁止直接在主工作区操作
2. **状态驱动 UI**：所有视图（画布/看板/Tab）共享同一份会话状态，WebSocket 事件驱动更新
3. **终端即真相**：Agent 输出通过终端复用器捕获，不通过自定义协议通信
4. **审批不可绕过**：危险操作必须经用户审批，Agent 适配器不得自动确认
5. **禁止遗留历史债务**：完成任务后必须同步清理废弃文件、死代码、过时注释和临时脚手架。迁移后旧路径立即删除，重构后旧实现立即移除，不得以「后续清理」为由搁置。AGENT.md / progress.md 中的「待清理」标记视为未完成任务。

---

## 已知问题 / 技术风险

| 问题 | 影响 | 处理建议 |
|------|------|----------|
| `node-pty` Windows 需 VC++ Build Tools | F3 开发环境 | 优先在 WSL2 / macOS；Windows 降级用 `child_process.spawn` |
| xterm.js + React 18 Strict Mode 双重挂载 | F3 内存泄露 | `useRef` 保护初始化，`useEffect` 返回 `dispose()` |
| Monaco Editor 包体积 ~2MB | F4 首屏性能 | 动态 `import()` 懒加载，仅审批弹窗打开时加载 |
| Node.js 22.10.0 < Vite 7 要求的 22.12+ | 开发环境警告 | 升级 Node.js 到 22.12+ 可消除警告，当前仍可正常运行 |

---

## 文档索引

- [docs/progress.md](docs/progress.md) — **开发进度快照**（接手新任务前必读）
- [docs/设计文档.md](docs/设计文档.md) — 完整产品架构、数据模型、视图设计、代码示例
- [docs/开发计划/phase-N-*.md](docs/开发计划/) — 各阶段详细任务拆解（已合并索引到 progress.md）
