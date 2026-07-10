# CLAUDE.md

---

## 项目概述

**Akari** 是一个 AI Agent 并行开发管理平台。完整产品架构见 [docs/设计文档.md](docs/设计文档.md)，开发计划见 [docs/开发计划.md](docs/开发计划.md)。

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
│   │       ├── hook-dispatcher.ts     # HookDispatcher（HTTP Hook 分发）
│   │       ├── workspace-manager.ts   # WorkspaceManager（工作区管理）
│   │       ├── settings-store.ts      # SettingsStore（设置持久化）
│   │       ├── git-utils.ts           # Git 工具函数
│   │       ├── canvas-edge-store.ts   # CanvasEdgeStore（画布连线持久化）
│   │       └── agent-adapters/        # AgentAdapter 接口 + ClaudeAdapter
│   │           ├── base.ts            # AgentAdapter 接口 + PtyCommand 类型
│   │           ├── claude.ts          # ClaudeAdapter（注入 .claude/settings.local.json Hook 配置）
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
│           ├── stores/workspace-store.ts # 工作区状态管理
│           ├── hooks/
│           │   ├── useWebSocket.ts    # 连接管理 + 自动重连（指数退避）
│           │   └── useResizablePanels.ts # 可拖拽分栏
│           ├── lib/
│           │   ├── utils.ts           # cn() 等工具函数
│           │   ├── api.ts             # API 调用封装
│           │   ├── terminalBus.ts     # 终端事件总线（模块级保活）
│           │   ├── fileUpdateBus.ts   # 文件更新事件总线
│           │   ├── ptyResizeMutex.ts  # 终端 resize 互斥锁
│           │   └── git-graph-utils.ts # Git 图布局算法
│           └── components/
│               ├── canvas/            # CanvasView + SessionNode + FlowEdge + CanvasContextMenu
│               ├── kanban/            # KanbanView + KanbanCard + KanbanColumn
│               ├── session/           # SessionSidebar + TerminalPanel + SessionInfoPanel + TaskPanel + MiddleTabBar + TabContent + DeleteSessionDialog
│               ├── diff/              # DiffViewer（Monaco DiffEditor）+ DiffFileList
│               ├── git/               # GitGraphPanel + GitContextMenu + GitCommitDialog + GitMergeDialog + GitGraphSvg + GitGraphRow
│               ├── command-center/    # CommandCenter（广播调后端 API）
│               ├── create-session/    # CreateSessionDialog（含 agentType 选择）
│               ├── layout/            # AppShell + TopNav + RightSidebar + SessionContextMenu
│               ├── settings/          # SettingsDialog
│               ├── workspace/         # WorkspaceSelector
│               ├── explorer/          # ExplorerPanel + FileTreeNode
│               ├── editor/            # FileEditor
│               ├── icons/             # ClaudeIcon
│               ├── theme-provider.tsx # 主题提供者
│               └── ui/                # shadcn/ui 组件
├── packages/
│   └── shared-types/                  # 前后端共享类型包
│       ├── package.json
│       └── src/
│           └── index.ts               # AgentSession / ServerMessage / ClientMessage / HookEvent 等
├── docs/
│   ├── 设计文档.md
│   ├── 开发计划.md
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
pnpm dev:server                  # 后端 http://localhost:3001
pnpm dev                       # 前端 http://localhost:5173

# 类型检查
pnpm typecheck                 # 全 workspace 类型检查
# 或单独
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
| GET | `/settings` | 获取设置（worktreeBaseDir） |
| PATCH | `/settings` | 更新设置（body: `{worktreeBaseDir?}`） |
| GET | `/sessions` | 获取所有会话 |
| POST | `/sessions` | 创建新会话（body: `{name, task, baseBranch?, agentType?, tags?, canvasPosition?}`） |
| PATCH | `/sessions/:id/status` | 更新会话状态（body: `{status}`，含状态机校验） |
| POST | `/sessions/:id/archive` | 归档会话 |
| POST | `/sessions/:id/restore` | 恢复归档会话 |
| DELETE | `/sessions/:id` | 删除会话 |
| PATCH | `/sessions/:id/canvas` | 更新画布位置（body: `{x, y}`） |

### 终端与 Diff

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sessions/:id/diff-content` | 获取文件 diff 内容（query: `file`） |
| GET | `/sessions/:id/diff-lines` | 获取文件 diff 行信息（query: `path`） |
| GET | `/sessions/:id/terminal-buffer` | 获取终端历史输出（query: `terminalId`） |

### 文件浏览与编辑

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sessions/:id/files` | 列出文件（query: `path?`） |
| GET | `/sessions/:id/file-content` | 读取文件内容（query: `path`） |
| POST | `/sessions/:id/file-content` | 写入文件内容（body: `{path, content}`） |

### Git 操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/repo/branches` | 获取仓库分支列表 |
| GET | `/sessions/:id/git-log` | 获取会话 Git 日志（query: `limit?`, `offset?`, `branch?`） |
| GET | `/sessions/:id/git-branches` | 获取会话 Git 分支 |
| POST | `/sessions/:id/git/commit` | Git commit（body: `{message}`） |
| POST | `/sessions/:id/git/merge` | Git merge（body: `{sourceBranch}`） |
| POST | `/sessions/:id/git/checkout` | Git checkout（body: `{branch, createNew?}`） |
| POST | `/sessions/:id/git/update-branch` | 从 base branch 更新（merge） |
| POST | `/sessions/:id/git/discard` | 丢弃所有变更 |
| POST | `/sessions/:id/git/discard-file` | 丢弃单个文件（body: `{filePath}`） |

### 工作区

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/workspaces` | 列出所有工作区 |
| POST | `/workspaces` | 添加工作区（body: `{name, path}`） |
| POST | `/workspaces/:id/switch` | 切换工作区 |
| DELETE | `/workspaces/:id` | 删除工作区 |

### 会话标签

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sessions/:id/tabs` | 获取会话标签 |
| POST | `/sessions/:id/tabs` | 创建标签（body: `{type, filePath?}`） |
| DELETE | `/sessions/:id/tabs/:tabId` | 关闭标签 |
| PATCH | `/sessions/:id/tabs/:tabId/activate` | 激活标签 |

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
| `terminal:data` | S→C | `payload: {sessionId, terminalId, data: string}` |
| `terminal:ready` | S→C | `payload: {sessionId, terminalId}` |
| `terminal:resized` | S→C | `payload: {sessionId, terminalId}` |
| `terminal:input` | C→S | `payload: {sessionId, terminalId, data: string}` |
| `terminal:resize` | C→S | `payload: {sessionId, terminalId, cols, rows}` |
| `diff:update` | S→C | `payload: {sessionId, diff: GitDiff}` |
| `file:update` | S→C | `payload: {sessionId, filePath, changeType}` |
| `git:log-updated` | S→C | `payload: {sessionId, commits, branches, head}` |
| `canvas:edges` | S→C | `payload: CanvasEdge[]` |
| `tab:created` | S→C | `payload: {sessionId, tab}` |
| `tab:closed` | S→C | `payload: {sessionId, tabId}` |
| `tab:activated` | S→C | `payload: {sessionId, tabId}` |
| `tabs:sync` | S→C | `payload: {sessionId, tabs, activeTabId}` |
| `workspace:list` | S→C | `payload: Workspace[]` |
| `workspace:current` | S→C | `payload: Workspace` |
| `broadcast:send` | C→S | `payload: {message: string, targets?: string[]}` |
| `tab:create` | C→S | `payload: {sessionId, type, filePath?}` |
| `tab:close` | C→S | `payload: {sessionId, tabId}` |
| `tab:activate` | C→S | `payload: {sessionId, tabId}` |
| `tab:reorder` | C→S | `payload: {sessionId, orderedTabIds}` |
| `terminal:create` | C→S | `payload: {sessionId}` |

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
- 所有需要二次确认的破坏性操作，统一使用 shadcn/ui `<Dialog>` 组件，**禁止使用内联 `confirmXxx` 状态**

**错误处理原则**
- 不做静默兜底（如 catch 后 fallback 到本地数据）；异常必须上报，让错误可见
- 兜底逻辑会掩盖真实问题，禁止以「降级」为由隐藏错误

**定位 Bug 的纪律**
- 找到根本原因前，不提交补丁；找到后，**回滚所有错误方向的补丁**，再应用最小化正确修复
---

## Agent 集成协议

实现 Agent 适配器时必须支持：

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

**ClaudeAdapter 实现方式**：
Worktree 初始化时，`prepare()` 自动写入 `.claude/settings.local.json`，向 Claude Code 注册 HTTP Hook：

| Hook 事件 | 行为 |
| :--- | :--- |
| `PermissionRequest` | 记录审批日志（当前**不阻塞** Claude Code 原生权限流程） |
| `SessionStart` | `initializing` → `idle` |
| `UserPromptSubmit` | `paused` / `waiting` / `idle` → `running` |
| `Stop` | `running` / `waiting` → `idle`，并广播 `session:lastMessage` |
| `StopFailure` | `running` / `paused` / `waiting` → `failed` |

> **历史说明**：早期版本通过终端输出解析 `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 魔法字符串驱动状态机，该机制已在 Phase 8 中完全废弃，改为 HTTP Hook 单轨驱动。

---

## Worktree 管理规范

- Worktree 基础目录：`<worktreeBaseDir>/<repoSlug>/<sessionId>/`（默认 `<repo>/.agent-worktrees/<repoSlug>/<sessionId>/`）
- 分支命名：`agent/<sessionId前8位>`
- 依赖隔离：通过符号链接复用 `node_modules`
- 清理：会话结束后必须调用 `removeWorktree()`

---

## 核心实现原则（禁止违反）

1. **物理隔离优先**：每个 Agent 会话使用独立 worktree，禁止直接在主工作区操作
2. **状态驱动 UI**：所有视图（画布/看板/Tab）共享同一份会话状态，WebSocket 事件驱动更新
3. **终端即真相**：Agent 输出通过终端复用器捕获，不通过自定义协议通信
4. **审批不可绕过**：危险操作必须经用户审批，Agent 适配器不得自动确认
5. **禁止遗留历史债务**：完成任务后必须同步清理废弃文件、死代码、过时注释和临时脚手架。迁移后旧路径立即删除，重构后旧实现立即移除，不得以「后续清理」为由搁置。AGENTS.md / progress.md 中的「待清理」标记视为未完成任务。
6. - 业务逻辑中保留最干净的分支，不要出现其他兼容或者历史债务代码，当已持久化的旧数据中出现被废弃的类型/字段时，应在 `SessionManager.initDb()` 里做一次性迁移，将数据改写为新形态，随后删除运行时兼容代码。不得以“兼容旧数据”为由在。
7. **重大决策必须先征询用户**：凡涉及以下任一情形，**禁止**自行做出决定并直接实施，必须先向用户说明方案对比、征得明确同意后再动手：
   - 技术方案降级或替代（如用 `child_process` 替代 `node-pty`、用 mock 替代真实实现）
   - 架构层面的设计取舍（如数据库选型、通信协议变更、模块拆分方式）
   - 破坏性 API/类型变更（影响已有接口的签名或行为）
   - 任何「此方案有明显缺点但省事」的捷径
   正确做法：先用 `ask_user_question` 工具列出选项和利弊，等待用户选择后再执行。不得在文档中写「降级方案」后自动采用该方案。
8. **禁止吞异常**：空 `catch {}` / 只写注释的 catch 一律禁止；前端用户操作失败必须 `toast.error()`；后端必须 `log.warn/error()`；状态机非法转换用 `validateTransition()` 守卫而非 try/catch。详见 [.claude/rules/error-handling.md](.claude/rules/error-handling.md)。
---

## 已知问题 / 技术风险

| 问题 | 影响 | 处理建议 |
|------|------|----------|
| `node-pty` Windows 需 VC++ Build Tools | F3 开发环境 | 已解决：VC++ Build Tools 已安装，node-pty 编译成功；Shell 已切换为 PowerShell 7.6.2 |
| ~~xterm.js + React 18 Strict Mode 双重挂载~~ | ~~F3 内存泄露~~ | 已解决：`TerminalPanel` 改用模块级 `terminalInstances` Map 保活 xterm 实例，切 Tab 不再 dispose/重建，terminalBus 订阅全程存活 |
| Monaco Editor 包体积 ~2MB | F4 首屏性能 | 动态 `import()` 懒加载，Diff 面板 / 文件编辑器打开时才加载 |
| ~~`.agent-worktrees/` 未加入 `.gitignore`~~ | ~~F2 误提交~~ | 已解决：已在 `.gitignore` 中添加 |
| 审批工作流未实现同步阻塞 | F8 安全性 | `PermissionRequest` Hook 当前仅记录日志，不挂起 HTTP 请求；Claude Code 仍使用原生权限确认。后续如需统一审批中心，需实现阻塞式审批 |
| 画布功能默认关闭 | F1 功能可用性 | `CANVAS_ENABLED = false`，当前主入口为看板 + Tab 视图 |

---

## 文档索引

- [docs/设计文档.md](docs/设计文档.md) — 完整产品架构、数据模型、视图设计、代码示例
- [.claude/rules/error-handling.md](.claude/rules/error-handling.md) — **异常处理规范**：禁止吞异常、前端用 toast 暴露错误、状态机用守卫代替 try/catch
- [docs/claude code 的hook参考.md](docs/claude%20code%20%E7%9A%84hook%E5%8F%82%E8%80%83.md) — Claude Code 的 hook 参考
- [docs/状态变化机制.md](docs/状态变化机制.md) — 基于 HTTP Hook 的状态流转机制
- [docs/开发计划/phase-8-基于Hooks的Agent状态流程机制改造计划.md](docs/开发计划/phase-8-基于Hooks的Agent状态流程机制改造计划.md) — Phase 8 HTTP Hook 改造详情
