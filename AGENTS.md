# AGENTS.md

本文件为 AI Coding Agent（Windsurf Cascade、Claude Code 等）提供在本仓库工作的上下文。

> **接手前必读**：[docs/progress.md](docs/progress.md) — 当前开发进度快照，含已完成模块、正在进行的任务和前置依赖关系。

---

## 项目概述

**Akari** 是一个 AI Agent 并行开发管理平台。完整产品架构见 [docs/设计文档.md](docs/设计文档.md)，开发计划见 [docs/开发计划.md](docs/开发计划.md)。

**当前状态（阶段八已完成）**：
- Monorepo 改造完成（pnpm workspaces）
- 后端 Fastify 骨架已运行（port 3001，WebSocket + REST）
- 前端已迁移至 `apps/web/`，通过 WebSocket 与后端实时通信
- Session Store 由 WebSocket 事件驱动，TopNav 显示连接状态指示灯
- 审批工作流完整闭环（后端 HookDispatcher + 前端审批 UI）
- Git 可视化已完成（提交图、Commit、Merge、Checkout、Discard）
- HTTP Hook 单轨驱动上线（魔法字符串机制已废弃）

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
终端: @xterm/xterm + FitAddon + WebLinksAddon
状态: Zustand
Diff: @monaco-editor/react（懒加载）

后端 (apps/server): Node.js + Fastify 5 + @fastify/websocket
终端复用: node-pty（PTY，Shell: PowerShell 7 / pwsh.exe）
Git 操作: simple-git
文件监听: chokidar
通信: WebSocket（ws://localhost:3001/ws）
数据库: SQLite - better-sqlite3

共享类型: packages/shared-types（workspace:*）
```

---

## 项目结构（当前实际）

```
akari/
├── apps/
│   ├── server/                        # 后端 Fastify 服务
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # 入口，端口 3001（REST + WebSocket）
│   │       ├── session-manager.ts     # SessionManager（SQLite + 状态机）
│   │       ├── worktree-manager.ts    # WorktreeManager（git worktree + chokidar diff）
│   │       ├── terminal-mux.ts        # TerminalMultiplexer（node-pty + 环形 Buffer）
│   │       ├── hook-dispatcher.ts     # HookDispatcher（ApprovalRegistry + HTTP Hook 分发）
│   │       ├── canvas-edge-store.ts   # CanvasEdgeStore（画布连线持久化）
│   │       └── agent-adapters/        # AgentAdapter 接口 + ClaudeAdapter
│   │           ├── base.ts            # AgentAdapter 接口 + PtyCommand 类型
│   │           ├── claude.ts          # ClaudeAdapter（--append-system-prompt）
│   │           └── index.ts           # createAgentAdapter() 工厂
│   ├── desktop/                       # Electron 桌面端
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── electron-builder.yml       # NSIS / portable 打包配置
│   │   ├── src/
│   │   │   ├── main.ts                # Electron 主进程（启动后端 + 加载前端）
│   │   │   └── preload.ts             # 预加载脚本（暴露最小 API）
│   │   └── dist/                      # tsc 输出
│   └── web/                           # 前端
│       ├── package.json
│       ├── vite.config.ts             # 含 /api 和 /ws 反向代理
│       ├── tsconfig.json / app / node
│       ├── index.html
│       └── src/
│           ├── types/index.ts         # 重新导出 @akari/shared-types
│           ├── stores/session-store.ts  # WebSocket 驱动，含 handleServerMessage
│           ├── hooks/
│           │   ├── useWebSocket.ts    # 连接管理 + 自动重连（指数退避）
│           │   └── useResizablePanels.ts # 可拖拽分栏
│           ├── lib/
│           │   ├── utils.ts           # cn() 等工具函数
│           │   ├── terminalBus.ts     # 终端事件总线（模块级保活）
│           │   ├── ptyResizeMutex.ts  # 终端 resize 互斥锁
│           │   └── git-graph-utils.ts # Git 图布局算法
│           └── components/
│               ├── canvas/            # CanvasView + SessionNode + FlowEdge + CanvasContextMenu
│               ├── kanban/            # KanbanView + KanbanCard + KanbanColumn
│               ├── session/           # SessionDetail + TerminalPanel + SessionInfoPanel
│               ├── diff/              # DiffViewer（Monaco DiffEditor）+ DiffFileList
│               ├── git/               # GitGraphPanel + GitContextMenu + GitCommitDialog + GitMergeDialog
│               ├── command-center/    # CommandCenter（广播调后端 API）
│               ├── create-session/    # CreateSessionDialog（含 agentType 选择）
│               ├── layout/            # AppShell + TopNav + RightSidebar
│               └── ui/                # shadcn/ui 组件
├── packages/
│   └── shared-types/                  # 前后端共享类型包
│       ├── package.json
│       └── src/
│           └── index.ts               # AgentSession / ServerMessage / ClientMessage / HookEvent 等
├── docs/
│   ├── 设计文档.md
│   ├── 开发计划.md
│   ├── progress.md                    # 进度快照（每次完成阶段后更新）
│   └── 开发计划/                      # phase-N-*.md 各阶段详细任务
├── pnpm-workspace.yaml
├── package.json                       # workspace root，含 dev:all / typecheck 脚本
├── AGENTS.md / CLAUDE.md              # AI Agent 上下文（内容相同）
└── .claude/rules/error-handling.md    # 异常处理规范
```

---

## 启动方式

```bash
# 安装依赖（首次或新增包后）
pnpm install

# 开发模式：同时启动前端 + 后端
pnpm dev:all

# 桌面端开发模式（启动前后端 + Electron）
pnpm dev:desktop

# 单独启动
pnpm --filter @akari/server dev   # 后端 http://localhost:3001
pnpm --filter @akari/web   dev    # 前端 http://localhost:5173

# 类型检查
pnpm --filter @akari/web    typecheck
pnpm --filter @akari/server typecheck
pnpm --filter @akari/desktop typecheck

# 桌面端生产打包（输出 NSIS 安装包 + portable）
pnpm build:desktop
```

---

## 已实现的后端接口

### 会话管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/sessions` | 获取所有会话 |
| POST | `/sessions` | 创建新会话（body: `{name, task, baseBranch, agentType, tags?, canvasPosition?}`） |
| PATCH | `/sessions/:id/status` | 更新会话状态（body: `{status}`，含状态机校验） |
| POST | `/sessions/:id/approval` | 审批决策（body: `{decision, comment?, approvalOption?}`） |
| POST | `/sessions/:id/approval-ignore` | 忽略审批（让 Claude Code 自行处理） |
| POST | `/sessions/:id/archive` | 归档会话 |
| POST | `/sessions/:id/restore` | 恢复归档会话 |
| DELETE | `/sessions/:id` | 删除会话 |
| PATCH | `/sessions/:id/canvas` | 更新画布位置（body: `{x, y}`） |

### 终端与 Diff

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sessions/:id/diff-content` | 获取文件 diff 内容（query: `file`） |
| GET | `/sessions/:id/terminal-buffer` | 获取终端历史输出 |

### Git 操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/repo/branches` | 获取仓库分支列表 |
| GET | `/sessions/:id/git-log` | 获取会话 Git 日志（query: `limit?`） |
| GET | `/sessions/:id/git-branches` | 获取会话 Git 分支 |
| POST | `/sessions/:id/git/commit` | Git commit（body: `{message}`） |
| POST | `/sessions/:id/git/merge` | Git merge（body: `{sourceBranch}`） |
| POST | `/sessions/:id/git/checkout` | Git checkout（body: `{branch, createNew?}`） |
| POST | `/sessions/:id/git/discard` | 丢弃所有变更 |

### 画布连线

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/canvas/edges` | 获取所有画布连线 |
| POST | `/canvas/edges` | 创建画布连线 |
| DELETE | `/canvas/edges/:edgeId` | 删除画布连线 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/broadcast` | 广播消息（body: `{message, targets?}`） |
| POST | `/sessions/:id/hooks` | HTTP Hook 入口（body: `HookEvent`） |
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
| `session:lastMessage` | S→C | `payload: {id, lastAiMessage}` |
| `terminal:data` | S→C | `payload: {sessionId, data: string}` |
| `terminal:ready` | S→C | `payload: {sessionId}` |
| `terminal:resized` | S→C | `payload: {sessionId}` |
| `terminal:input` | C→S | `payload: {sessionId, data: string}` |
| `terminal:resize` | C→S | `payload: {sessionId, cols, rows}` |
| `diff:update` | S→C | `payload: {sessionId, diff: GitDiff}` |
| `approval:required` | S→C | `payload: {sessionId, request: ApprovalRequest}` |
| `approval:decision` | C→S | `payload: {sessionId, decision, comment?}` |
| `checkpoint:reached` | S→C | `payload: {sessionId, description: string}` |
| `git:log-updated` | S→C | `payload: {sessionId, commits, branches, head}` |
| `canvas:edges` | S→C | `payload: CanvasEdge[]` |
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

**错误处理原则**
- 不做静默兜底（如 catch 后 fallback 到本地数据）；异常必须上报，让错误可见
- 兜底逻辑会掩盖真实问题，禁止以「降级」为由隐藏错误

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
5. **禁止遗留历史债务**：完成任务后必须同步清理废弃文件、死代码、过时注释和临时脚手架。迁移后旧路径立即删除，重构后旧实现立即移除，不得以「后续清理」为由搁置。AGENTS.md / progress.md 中的「待清理」标记视为未完成任务。
6. **重大决策必须先征询用户**：凡涉及以下任一情形，**禁止**自行做出决定并直接实施，必须先向用户说明方案对比、征得明确同意后再动手：
   - 技术方案降级或替代（如用 `child_process` 替代 `node-pty`、用 mock 替代真实实现）
   - 架构层面的设计取舍（如数据库选型、通信协议变更、模块拆分方式）
   - 破坏性 API/类型变更（影响已有接口的签名或行为）
   - 任何「此方案有明显缺点但省事」的捷径
   正确做法：先用 `ask_user_question` 工具列出选项和利弊，等待用户选择后再执行。不得在文档中写「降级方案」后自动采用该方案。
7. **禁止吞异常**：空 `catch {}` / 只写注释的 catch 一律禁止；前端用户操作失败必须 `toast.error()`；后端必须 `log.warn/error()`；状态机非法转换用 `validateTransition()` 守卫而非 try/catch。详见 [.claude/rules/error-handling.md](.claude/rules/error-handling.md)。
---

## 已知问题 / 技术风险

| 问题 | 影响 | 处理建议 |
|------|------|----------|
| Monaco Editor 包体积 ~2MB | F4 首屏性能 | 动态 `import()` 懒加载，仅审批弹窗打开时加载 |

---

## 文档索引

- [docs/设计文档.md](docs/设计文档.md) — 完整产品架构、数据模型、视图设计、代码示例
- [docs/开发计划/phase-N-*.md](docs/开发计划/) — 各阶段详细任务拆解（已合并索引到 progress.md）
- [.claude/rules/error-handling.md](.claude/rules/error-handling.md) — **异常处理规范**：禁止吞异常、前端用 toast 暴露错误、状态机用守卫代替 try/catch
- [docs/claude code 的hook参考.md](docs/claude%20code%20%E7%9A%84hook%E5%8F%82%E8%80%83.md) — Claude Code 的 hook 参考
