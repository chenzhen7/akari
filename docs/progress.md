# Akari — 开发进度快照

> 此文件供新 Agent 会话快速同步项目状态，每次推进后**手动更新**。  
> 完整需求见 `docs/设计文档.md`，各阶段详情见 `docs/开发计划/phase-N-*.md`，编码规范见 `AGENT.md`。

---

## 项目一句话定位

Akari 是一个 **AI Agent 并行开发管理平台**：用户在无限画布 / 看板上监控多个并行 Agent 会话，每个会话运行在独立 Git Worktree 中，用户通过审批工作流控制危险操作和代码合并。

---

## 当前状态（2026-06-02）

**整体进度**：**阶段八（HTTP Hooks 机制改造）全部完成**。魔法字符串机制已完全废弃，HTTP Hook 单轨驱动上线。阶段七改造完成：`SPAWN_AGENT` / `DELEGATE` / `AWAIT_SESSION` 协议检测**全部移除**，改为纯 REST 端点 + UI 按钮触发。协作管理面板中 Orchestrator 的 System Prompt 也已同步更新为 REST 调用说明。

**文档同步说明**：本文件与 `AGENTS.md` / `CLAUDE.md` 同步更新。若发现三处描述不一致，以本文件（progress.md）和实际源码为准。

### ✅ 已完成

| 模块 | 关键文件 | 备注 |
|------|----------|------|
| 核心类型 | `packages/shared-types/src/index.ts` | `AgentSession` / `ServerMessage` / `ClientMessage` 等 |
| pnpm Monorepo | `pnpm-workspace.yaml` | apps/* + packages/* |
| Fastify 后端骨架 | `apps/server/src/index.ts` | port 39321，REST + WebSocket，使用 SessionManager |
| WorktreeManager | `apps/server/src/worktree-manager.ts` | git worktree 创建/删除/diff/watch，分支自动回退 |
| TerminalMultiplexer | `apps/server/src/terminal-mux.ts` | node-pty 真实 PTY（PowerShell 7）；环形 Buffer 5000 行；支持 resize 同步；魔法字符串**已全部移除** |
| HookDispatcher | `apps/server/src/hook-dispatcher.ts` | ApprovalRegistry（Promise 挂起）+ dispatchHookEvent；PermissionRequest 同步阻塞审批 |
| HTTP Hook 类型 | `packages/shared-types/src/index.ts` | HookEvent / HookResponse / HookEventName 及全量 Payload 类型 |
| SessionManager | `apps/server/src/session-manager.ts` | SQLite 持久化，状态机，协调 WorktreeManager + TerminalMux |
| SQLite 数据库 | `apps/server/data/akari.db` | better-sqlite3，服务重启后会话可恢复 |
| WebSocket Hook | `apps/web/src/hooks/useWebSocket.ts` | 指数退避自动重连，最多 10 次 |
| Session Store | `apps/web/src/stores/session-store.ts` | WebSocket 事件驱动，addSession/approve 调后端 API |
| 连接状态指示器 | `apps/web/src/components/layout/TopNav.tsx` | 绿/黄脉冲/橙/红，断线计时 |
| 无限画布 | `apps/web/src/components/canvas/` | 基于 `@xyflow/react`，节点可拖动 |
| 看板 | `apps/web/src/components/kanban/` | 基于 `@dnd-kit`，列间拖拽 |
| 会话详情 / 终端 | `apps/web/src/components/session/` | xterm.js 真实终端（node-pty PTY + PowerShell 7），支持完整 ANSI 颜色；`TerminalPanel` 用模块级 `terminalInstances` Map 保活实例，切 Tab 仅 DOM reparent，无重复/乱版 |
| Diff 视图 | `apps/web/src/components/diff/DiffViewer.tsx` | Monaco **DiffEditor**（side-by-side，VS Code 风格）；左侧文件列表可点击切换；按需调 `GET /sessions/:id/diff-content` 获取 original/modified；`--numstat` 提供准确行数；`resolvedBase` 修复 master 仓库 diff 失效问题 |
| 指挥中心 | `apps/web/src/components/command-center/` | 广播调后端 `/broadcast` API |
| 创建会话弹窗 | `apps/web/src/components/create-session/` | 含 agentType 选择，initializing spinner，session:created 自动打开 Tab |
| AgentAdapter 接口 | `apps/server/src/agent-adapters/base.ts` | `AgentAdapter` 接口 + `PtyCommand` 类型 |
| ClaudeAdapter | `apps/server/src/agent-adapters/claude.ts` | 交互模式启动 `claude`，`--append-system-prompt` 注入 Akari 协议，2.5s 延迟后自动注入任务 |
| 适配器工厂 | `apps/server/src/agent-adapters/index.ts` | `createAgentAdapter(agentType)` 工厂，SessionManager 集成 |
| CanvasEdgeStore | `apps/server/src/canvas-edge-store.ts` | 画布连线独立持久化（DB 表 `canvas_edges`）|
| Canvas 连线持久化 API | `apps/server/src/index.ts` | `GET/POST/DELETE /canvas/edges` REST 端点 + `canvas:edges` WS 事件 |
| Git 可视化 | `apps/web/src/components/git/GitGraphPanel.tsx` | Git 提交图（SVG 渲染）、分支/Commit/Merge/Checkout/Discard |
| Diff 视图 | `apps/web/src/components/diff/DiffViewer.tsx` | Monaco DiffEditor（side-by-side）、DiffFileList、resolvedBase 修复 |
| 审批 UI | `apps/web/src/components/session/SessionInfoPanel.tsx` | ApprovalRequest 渲染、选项按钮、批量审批 |
| 画布节点 Handle | `apps/web/src/components/canvas/SessionNode.tsx` | source/target Handle（hover 显现）；claude-orchestrator 图标 |
| Electron 桌面端 | `apps/desktop/` | 独立 Electron 封装层，生产环境由后端 serve 前端 dist，输出 NSIS / portable |
| 后端静态资源服务 | `apps/server/src/index.ts` | `WEB_DIST_PATH` 存在时 serve `apps/web/dist`，支持 `PORT=0` 随机端口 |

### 🔄 已回退（Phase-7 多 Agent 协作）

> **原因**：群组/pipeline 机制在 worktree 物理隔离前提下无法让子 Agent 访问父 Agent 代码，属于设计层面的不兼容。群组功能已全部移除，保留 Canvas 连线持久化作为独立功能。

| 模块 | 状态 | 说明 |
|------|------|------|
| CollaborationManager | 已删除 | `apps/server/src/collaboration-manager.ts` 已删除 |
| `/collaboration/*` REST API | 已移除 | 全部 13 个端点已移除 |
| CollaborationPanel | 已删除 | 右侧 Sheet 面板已移除 |
| Spawn Dialog + role badge | 已移除 | SessionNode 中的派生 Agent 按钮和角色标签已移除 |
| ClaudeOrchestratorAdapter | 已删除 | orchestrator 专属适配器已移除 |
| `claude-orchestrator` agent type | 保留 | `createAgentAdapter` 仍可识别，但走 fallback（null），不自动启动 |

### 🔲 待开发（按功能模块）

| # | 功能模块 | BE 核心文件 | FE 核心文件 | 前置依赖 |
|---|----------|-------------|-------------|----------|
| F1 | **会话管理 CRUD** | `session-manager.ts`、SQLite schema | Store 移除 Mock 数据，完全由 WS 驱动 | F0 ✅ |
| F2 | **Worktree 管理** | `worktree-manager.ts`（simple-git） | 创建进度反馈、画布/看板状态同步 | F1 |
| F3 | **终端多路复用** | `terminal-mux.ts`（node-pty） | `TerminalPanel` 接 xterm.js | F1 |
| F4 | **实时 Diff** | chokidar 监听 + `git diff` 推送 | `DiffViewer.tsx`（Monaco Diff Editor） | F2 ✅ |
| F5 | **审批工作流** | `hook-dispatcher.ts`（ApprovalRegistry） | `SessionInfoPanel.tsx` 审批 UI、CommandCenter | F3 + F4 ✅ |
| F6 | **Agent 适配器** | `agent-adapters/claude.ts` + `aider.ts` | — | F2 + F3 |
| F7 | **收尾打磨** | 错误处理、重连、超时 | 快捷键、全局搜索、报告导出 | F1-F6 |

---

## 当前正在进行

> 无阻塞项，阶段八全部完成。

---

## 阶段进度

| 阶段 | 内容 | 状态 | 详情 |
|------|------|------|------|
| 阶段一 | Monorepo + 后端骨架 + WebSocket 联通 | ✅ 完成 | [phase-1](./开发计划/phase-1-工程化基础.md) |
| 阶段二 | WorktreeManager + TerminalMux + SessionManager | ✅ 完成 | [phase-2](./开发计划/phase-2-核心后端.md) |
| 阶段三 | xterm.js 终端 + Monaco Diff + 创建流程 | ✅ 完成 | [phase-3](./开发计划/phase-3-前端真实化.md) |
| 阶段四 | 审批后端 + 审批 UI | 完成 | [phase-4](./开发计划/phase-4-审批工作流.md) |
| 阶段五 | Claude / Aider / Shell 适配器 | ✅ Claude + Orchestrator 完成 | [phase-5](./开发计划/phase-5-Agent适配器.md) |
| 阶段六 | Git 可视化 | 完成 | [phase-6](./开发计划/phase-6-git可视化.md) |
| 阶段七 | 多 Agent 协作 | 🔄 已回退（群组功能移除，保留 Canvas 连线持久化） | [phase-7](./开发计划/phase-7-多agent协作.md) |
| 阶段八 | 基于 Hooks 的 Agent 状态流程机制改造 | ✅ 核心完成（8.1~8.4，PreToolUse/MCP 暂不做） | [phase-8](./开发计划/phase-8-基于Hooks的Agent状态流程机制改造计划.md) |

## 里程碑

| 里程碑 | 对应阶段 | 状态 |
|--------|---------|------|
| **M1** Monorepo + WebSocket 联通 | 阶段一 | ✅ |
| **M2** 会话生命周期完整跑通 | 阶段二 | ✅ |
| **M3** 真实终端 + Diff + 创建流程 | 阶段三 | ✅ |
| **M4** 审批工作流闭环 | 阶段四 | 完成 |
| **M5** Claude Code / Aider 可用 | 阶段五 | � Claude 适配已完成，待验证 |
| **M6** 生产就绪 | 阶段六 | 完成 |

---

## 关键约定（Agent 必读）

### 目录结构（当前实际）
```
akari/
├── apps/
│   ├── server/
│   │   ├── data/akari.db          # ✅ SQLite 持久化数据库
│   │   └── src/
│   │       ├── index.ts           # ✅ Fastify 入口，端口 39321
│   │       ├── session-manager.ts # ✅ SessionManager（SQLite + 状态机）
│   │       ├── worktree-manager.ts# ✅ WorktreeManager（git worktree + chokidar diff）
│   │       ├── terminal-mux.ts    # ✅ TerminalMultiplexer（node-pty + 环形 Buffer）
│   │       ├── hook-dispatcher.ts # ✅ HookDispatcher（ApprovalRegistry + HTTP Hook）
│   │       ├── canvas-edge-store.ts # ✅ CanvasEdgeStore（DB 表 canvas_edges）
│   │       └── agent-adapters/    # ✅ AgentAdapter 接口 + ClaudeAdapter
│   │           ├── base.ts        # AgentAdapter 接口 + PtyCommand 类型
│   │           ├── claude.ts      # ClaudeAdapter（--append-system-prompt）
│   │           └── index.ts       # createAgentAdapter() 工厂
│   ├── desktop/                 # ✅ Electron 桌面端封装（主进程 + 打包配置）
│   │   ├── src/main.ts          # Electron 主进程，启动后端并加载前端
│   │   ├── src/preload.ts       # 预加载脚本（暴露最小 API）
│   │   ├── electron-builder.yml # NSIS / portable 打包配置
│   │   └── package.json
│   └── web/src/
│       ├── components/            # ✅ 全部前端组件
│       │   ├── canvas/            # CanvasView + SessionNode + FlowEdge + ContextMenu
│       │   ├── kanban/            # KanbanView + KanbanCard + KanbanColumn
│       │   ├── session/           # SessionDetail + TerminalPanel + SessionInfoPanel
│       │   ├── diff/              # DiffViewer + DiffFileList
│       │   ├── git/               # GitGraphPanel + GitContextMenu + Dialogs
│       │   ├── command-center/    # CommandCenter
│       │   ├── create-session/    # CreateSessionDialog
│       │   └── layout/            # AppShell + TopNav + RightSidebar
│       ├── stores/session-store.ts  # ✅ WebSocket 驱动
│       ├── hooks/
│       │   ├── useWebSocket.ts    # ✅ 自动重连
│       │   └── useResizablePanels.ts # ✅ 可拖拽分栏
│       ├── lib/
│       │   ├── utils.ts           # cn() 工具
│       │   ├── terminalBus.ts     # 终端事件总线
│       │   ├── ptyResizeMutex.ts  # resize 互斥锁
│       │   └── git-graph-utils.ts # Git 图布局算法
│       └── types/index.ts         # 重新导出 @akari/shared-types
└── packages/shared-types/src/     # ✅ 前后端共享类型
    └── index.ts
```


### 核心原则（禁止违反）
1. 每个 Agent 会话必须运行在独立 `git worktree`，禁止直接在主工作区操作
2. 危险操作必须经 `approval-workflow.ts` 的 `handleApproval`，禁止 Agent 适配器自动回复
3. 所有视图（画布/看板/Tab）共享同一 Zustand store，状态由 WebSocket 事件驱动更新
4. Worktree 路径：`<repo>/.agent-worktrees/<sessionId>/`，分支：`agent/<taskName>-<sessionId前8位>`

---

## 后端依赖速查

```bash
# apps/server
pnpm add fastify @fastify/websocket node-pty simple-git chokidar better-sqlite3 execa fs-extra
pnpm add -D @types/better-sqlite3 @types/node typescript tsx

# apps/web（新增）
pnpm add xterm xterm-addon-fit xterm-addon-web-links @monaco-editor/react
```

---

## 已知问题 / 技术风险

| 问题 | 影响 | 处理建议 |
|------|------|----------|
| `node-pty` Windows 需 VC++ Build Tools | F3 开发环境 | ✅ 已解决：VC++ Build Tools 已安装，node-pty 编译成功；Shell 已切换为 PowerShell 7.6.2 |
| ~~xterm.js + React 18 Strict Mode 双重挂载~~ | ~~F3 内存泄露~~ | ✅ 已解决：`TerminalPanel` 改用模块级 `terminalInstances` Map 保活 xterm 实例，切 Tab 不再 dispose/重建，订阅全程存活 |
| Monaco Editor 包体积 ~2MB | F4 首屏性能 | 动态 `import()` 懒加载，仅审批弹窗打开时加载 |
| ~~`.agent-worktrees/` 未加入 `.gitignore`~~ | ~~F2 误提交~~ | ✅ 已在 `.gitignore` 中添加 |

---

## 如何接手一个模块

1. 阅读 `docs/设计文档.md` 对应章节（含代码示例）
2. 确认**前置依赖**模块已完成（见上方表格）
3. 在本文件「当前正在进行」一栏填写模块编号和负责人
4. 完成后更新上方「✅ 已完成」表格，清空「当前正在进行」
