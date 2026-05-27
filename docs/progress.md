# Akari — 开发进度快照

> 此文件供新 Agent 会话快速同步项目状态，每次推进后**手动更新**。  
> 完整需求见 `docs/设计文档.md`，各阶段详情见 `docs/开发计划/phase-N-*.md`，编码规范见 `AGENT.md`。

---

## 项目一句话定位

Akari 是一个 **AI Agent 并行开发管理平台**：用户在无限画布 / 看板上监控多个并行 Agent 会话，每个会话运行在独立 Git Worktree 中，用户通过审批工作流控制危险操作和代码合并。

---

## 当前状态（2026-05-27）

**整体进度**：**阶段八（HTTP Hooks 机制改造）核心实现完成**。魔法字符串机制已完全废弃，HTTP Hook 单轨驱动上线：`HookDispatcher` + `ApprovalRegistry` 就绪，`PermissionRequest` 同步阻塞审批闭环可用，ClaudeAdapter 自动写入 `.claude/settings.json`，`detectMarkers()` 已删除。PreToolUse/MCP 部分标记暂不做，留待后续阶段。

### ✅ 已完成

| 模块 | 关键文件 | 备注 |
|------|----------|------|
| 核心类型 | `packages/shared-types/src/index.ts` | `AgentSession` / `ServerMessage` / `ClientMessage` 等 |
| pnpm Monorepo | `pnpm-workspace.yaml` | apps/* + packages/* |
| Fastify 后端骨架 | `apps/server/src/index.ts` | port 3001，REST + WebSocket，使用 SessionManager |
| WorktreeManager | `apps/server/src/worktree-manager.ts` | git worktree 创建/删除/diff/watch，分支自动回退 |
| TerminalMultiplexer | `apps/server/src/terminal-mux.ts` | node-pty 真实 PTY（PowerShell 7）；环形 Buffer 5000 行；支持 resize 同步；魔法字符串已删除 |
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
| ClaudeOrchestratorAdapter | `apps/server/src/agent-adapters/claude.ts` | 注入完整 Orchestrator system prompt，协作协议标记说明 |
| 适配器工厂 | `apps/server/src/agent-adapters/index.ts` | `createAgentAdapter(agentType)` 工厂，SessionManager 集成 |
| CollaborationManager | `apps/server/src/collaboration-manager.ts` | 群组 CRUD、流水线边、DAG 环检测、AWAIT/DELEGATE/SPAWN 处理、SQLite 持久化 |
| 协作 REST API | `apps/server/src/index.ts` | `/collaboration/groups` 全套 CRUD + edges + messages |
| 协作协议标记 | `apps/server/src/terminal-mux.ts` | SPAWN_AGENT / DELEGATE / TASK_DONE / AWAIT_SESSION 解析并 emit 事件 |
| 画布 Pipeline 边 | `apps/web/src/components/canvas/CanvasView.tsx` | 从 groups 同步边（实线箭头）+ 派生关系（虚线）；拖线自动创建群组+边 |
| SessionNode Handle | `apps/web/src/components/canvas/SessionNode.tsx` | source/target Handle（hover 显现）；orchestrator/worker role badge；claude-orchestrator 棕色皇冠图标 |
| CollaborationPanel | `apps/web/src/components/collaboration/CollaborationPanel.tsx` | 右侧 Sheet；群组列表、成员、Pipeline 边、共享上下文编辑 |
| TopNav 协作按钮 | `apps/web/src/components/layout/TopNav.tsx` | Network 图标按钮，有群组时显示数量角标 |

### 🔲 待开发（按功能模块）

| # | 功能模块 | BE 核心文件 | FE 核心文件 | 前置依赖 |
|---|----------|-------------|-------------|----------|
| F1 | **会话管理 CRUD** | `session-manager.ts`、SQLite schema | Store 移除 Mock 数据，完全由 WS 驱动 | F0 ✅ |
| F2 | **Worktree 管理** | `worktree-manager.ts`（simple-git） | 创建进度反馈、画布/看板状态同步 | F1 |
| F3 | **终端多路复用** | `terminal-mux.ts`（node-pty） | `TerminalPanel` 接 xterm.js | F1 |
| F4 | **实时 Diff** | chokidar 监听 + `git diff` 推送 | `DiffViewer.tsx`（Monaco Diff Editor） | F2 |
| F5 | **审批工作流** | `approval-workflow.ts` | 审批弹窗、批量审批、TopNav 角标 | F3 + F4 |
| F6 | **Agent 适配器** | `agent-adapters/claude.ts` + `aider.ts` | — | F2 + F3 |
| F7 | **收尾打磨** | 错误处理、重连、超时 | 快捷键、全局搜索、报告导出 | F1-F6 |

---

## 当前正在进行

> 📌 **F6 Agent 适配器（阶段五）** — Claude 适配已完成，待测试验证；Aider / Shell 适配器为后续任务

---

## 阶段进度

| 阶段 | 内容 | 状态 | 详情 |
|------|------|------|------|
| 阶段一 | Monorepo + 后端骨架 + WebSocket 联通 | ✅ 完成 | [phase-1](./开发计划/phase-1-工程化基础.md) |
| 阶段二 | WorktreeManager + TerminalMux + SessionManager | ✅ 完成 | [phase-2](./开发计划/phase-2-核心后端.md) |
| 阶段三 | xterm.js 终端 + Monaco Diff + 创建流程 | ✅ 完成 | [phase-3](./开发计划/phase-3-前端真实化.md) |
| 阶段四 | 审批后端 + 审批 UI | 🔲 待开始 | [phase-4](./开发计划/phase-4-审批工作流.md) |
| 阶段五 | Claude / Aider / Shell 适配器 | ✅ Claude + Orchestrator 完成 | [phase-5](./开发计划/phase-5-Agent适配器.md) |
| 阶段六 | Git 可视化 | 🔲 待开始 | [phase-6](./开发计划/phase-6-git可视化.md) |
| 阶段七 | 多 Agent 协作 | ✅ 基础实现完成（M7-α + M7-β + M7-γ 核心） | [phase-7](./开发计划/phase-7-多agent协作.md) |
| 阶段八 | 基于 Hooks 的 Agent 状态流程机制改造 | ✅ 核心完成（8.1~8.4，PreToolUse/MCP 暂不做） | [phase-8](./开发计划/phase-8-基于Hooks的Agent状态流程机制改造计划.md) |

## 里程碑

| 里程碑 | 对应阶段 | 状态 |
|--------|---------|------|
| **M1** Monorepo + WebSocket 联通 | 阶段一 | ✅ |
| **M2** 会话生命周期完整跑通 | 阶段二 | ✅ |
| **M3** 真实终端 + Diff + 创建流程 | 阶段三 | ✅ |
| **M4** 审批工作流闭环 | 阶段四 | 🔲 |
| **M5** Claude Code / Aider 可用 | 阶段五 | � Claude 适配已完成，待验证 |
| **M6** 生产就绪 | 阶段六 | 🔲 |

---

## 关键约定（Agent 必读）

### 目录结构（当前实际）
```
akari/
├── apps/
│   ├── server/
│   │   ├── data/akari.db          # ✅ SQLite 持久化数据库
│   │   └── src/
│   │       ├── index.ts           # ✅ Fastify 入口，端口 3001
│   │       ├── session-manager.ts # ✅ SessionManager（SQLite + 状态机）
│   │       ├── worktree-manager.ts# ✅ WorktreeManager（git worktree + chokidar diff）
│   │       ├── terminal-mux.ts    # ✅ TerminalMultiplexer（child_process + 环形 Buffer）
│       └── agent-adapters/    # ✅ AgentAdapter 接口 + ClaudeAdapter（阶段五）
│           ├── base.ts        # AgentAdapter 接口 + PtyCommand 类型
│           ├── claude.ts      # ClaudeAdapter（--append-system-prompt，交互模式）
│           └── index.ts       # createAgentAdapter() 工厂
│   └── web/src/
│       ├── components/            # ✅ 全部前端组件
│       ├── stores/session-store.ts  # ✅ WebSocket 驱动
│       ├── hooks/useWebSocket.ts  # ✅ 自动重连
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
