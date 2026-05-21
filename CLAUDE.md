# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在本仓库中工作的指导。

> **接手前必读**：[docs/progress.md](docs/progress.md) — 当前开发进度快照，包含已完成模块、正在进行的任务和前置依赖关系。

## 项目概述

**Akari** 是一个 AI Agent 并行开发管理平台。完整产品架构见 [docs/设计文档.md](docs/设计文档.md)，开发计划见 [docs/开发计划.md](docs/开发计划.md)。

**当前状态**：前端 UI 骨架已完成（画布、看板、终端面板、指挥中心均为静态 Mock 数据）；后端尚未启动，Monorepo 结构尚未改造。架构包括：无限画布、看板视图、标签页会话视图、终端多路复用、Git worktree 管理以及 Agent 适配器（Claude、Aider 等）。

**核心理念：「指挥中心」模式**
- 用户是指挥官，Agent 是并行执行的士兵
- 无限画布 = 战场全局视图
- 看板 = 任务状态流转
- Tab = 快速聚焦单个战场
- Worktree = 物理隔离的并行战线

## 技术栈

```
前端: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
画布: @xyflow/react
看板: @dnd-kit/core
终端: xterm.js
状态: Zustand
Diff: Monaco Editor

后端: Node.js + Fastify
终端复用: node-pty
Git 操作: simple-git
文件监听: chokidar
通信: WebSocket
数据库: SQLite (better-sqlite3)
```

## 项目结构

### 当前实际结构（单包，Monorepo 改造前）

```
akari/
├── src/
│   ├── types/index.ts              # AgentSession / SessionStatus / KanbanColumn
│   ├── stores/session-store.ts     # Zustand store（含 Mock 数据）
│   ├── components/
│   │   ├── canvas/                 # CanvasView + SessionNode (@xyflow/react)
│   │   ├── kanban/                 # KanbanView + KanbanCard + KanbanColumn (@dnd-kit)
│   │   ├── session/                # SessionDetail + TaskPanel + TerminalPanel
│   │   ├── command-center/         # CommandCenter（广播 + 批量审批面板）
│   │   ├── create-session/         # CreateSessionDialog
│   │   ├── layout/                 # AppShell + TopNav
│   │   └── ui/                     # shadcn/ui 组件
│   └── lib/utils.ts
└── docs/
    ├── 设计文档.md
    ├── 开发计划.md
    └── progress.md
```

### 目标结构（Monorepo 改造后）

```
akari/
├── apps/
│   ├── server/src/                 # Node.js 后端 (Fastify + WebSocket)
│   │   ├── index.ts                # 入口，端口 3001
│   │   ├── session-manager.ts
│   │   ├── worktree-manager.ts
│   │   ├── terminal-mux.ts
│   │   ├── approval-workflow.ts
│   │   └── agent-adapters/
│   └── web/src/                    # 前端迁移至此
│       ├── components/
│       ├── stores/
│       └── hooks/useWebSocket.ts   # 新增
├── packages/shared-types/src/      # 前后端共享类型
└── package.json                    # pnpm workspaces
```

## 编码规范

### TypeScript
- 严格模式 (`strict: true`)
- 所有公共 API 必须显式标注返回类型
- 优先使用 `interface` 定义对象类型
- 使用类型守卫替代 `as` 断言

### React
- 函数组件 + Hooks
- Props 使用解构，命名规范：`ComponentNameProps`
- 状态管理使用 Zustand，避免深层 prop drilling
- 副作用集中放在自定义 Hooks 中

### 命名约定
- 文件: PascalCase (组件), camelCase (工具), kebab-case (配置)
- 变量: camelCase
- 常量: UPPER_SNAKE_CASE
- 类型/接口: PascalCase
- CSS 类: Tailwind 优先，复杂样式使用 `cn()` 工具函数


## Agent 集成协议

当实现 Agent 适配器时，必须支持以下协议：

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
- 完成重要步骤：`[CHECKPOINT] <描述>`
- 需要执行危险操作：`[APPROVAL_REQUIRED] type=destructive command="<命令>"`
- 准备合并：`[APPROVAL_REQUIRED] type=merge-ready`

## Worktree 管理规范

所有 Git 操作必须通过 `WorktreeManager`：
- Worktree 基础目录：`<repo>/.agent-worktrees/<sessionId>/`
- 分支命名：`agent/<taskName>-<sessionId前8位>`
- 依赖隔离：通过符号链接复用 `node_modules`
- 清理：会话结束后必须调用 `removeWorktree()`

## 关键实现原则

1. **物理隔离优先**：每个 Agent 会话使用独立 worktree，禁止直接在主工作区操作
2. **状态驱动 UI**：所有视图（画布/看板/Tab）共享同一份会话状态，通过 Zustand 同步
3. **终端即真相**：Agent 的输出通过终端复用器捕获，不通过自定义协议通信
4. **审批不可绕过**：危险操作（ destructive ops ）必须经用户审批，Agent 适配器不得自动确认

## WebSocket 事件协议

前后端通过以下事件通信（实现时严格遵守字段名）：

| 事件名 | 方向 | 关键 Payload 字段 |
|--------|------|-------------------|
| `session:created` | S→C | `session: AgentSession` |
| `session:status` | S→C | `id, status, progress` |
| `terminal:data` | S→C | `sessionId, data: string` |
| `terminal:input` | C→S | `sessionId, data: string` |
| `diff:update` | S→C | `sessionId, diff: GitDiff` |
| `approval:required` | S→C | `sessionId, request: ApprovalRequest, diff` |
| `approval:decision` | C→S | `sessionId, decision: 'approved' \| 'rejected'` |
| `broadcast:send` | C→S | `message: string, targets?: string[]` |

## 开发注意事项

- **node-pty on Windows**：需要 VC++ Build Tools，建议在 WSL2 / macOS 开发；Windows 可降级用 `child_process.spawn` 模拟
- **xterm.js + React 18 Strict Mode**：用 `useRef` 保护 Terminal 实例初始化，`useEffect` 必须返回 `dispose()`，防止双重挂载内存泄露
- **Monaco Editor**：动态 `import()` 懒加载，体积约 2MB，不可同步引入
- **`.agent-worktrees/`**：Monorepo 改造时立即加入 `.gitignore`

## 开发任务优先级

| 模块 | 前置 | 说明 |
|------|------|------|
| F0 工程化基础 | — | Monorepo + 后端骨架 + WebSocket 联通 |
| F1 会话管理 | F0 | SessionManager + SQLite + REST API |
| F2 Worktree 管理 | F1 | WorktreeManager (simple-git) |
| F3 终端多路复用 | F1 | TerminalMux (node-pty) + xterm.js |
| F4 实时 Diff | F2 | chokidar + git diff + Monaco |
| F5 审批工作流 | F3+F4 | ApprovalWorkflow + 审批 UI |
| F6 Agent 适配器 | F2+F3 | Claude / Aider / 自定义 Shell |
| F7 收尾打磨 | F1-F6 | 错误处理 + 测试 + UX |

## 文档索引

> Agent 必读：执行任务前必须先按需加载以下规则

- [docs/progress.md](docs/progress.md) — **开发进度快照**（接手新任务前必读）
- [docs/设计文档.md](docs/设计文档.md) — 完整产品架构、数据模型、视图设计、代码示例
- [docs/开发计划.md](docs/开发计划.md) — 分阶段任务拆解、依赖关系、里程碑