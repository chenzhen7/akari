# Akari — 开发进度快照

> 此文件供新 Agent 会话快速同步项目状态，每次推进后**手动更新**。  
> 完整需求见 `docs/设计文档.md`，完整计划见 `docs/开发计划.md`，编码规范见 `AGENT.md`。

---

## 项目一句话定位

Akari 是一个 **AI Agent 并行开发管理平台**：用户在无限画布 / 看板上监控多个并行 Agent 会话，每个会话运行在独立 Git Worktree 中，用户通过审批工作流控制危险操作和代码合并。

---

## 当前状态（2026-05-21）

**整体进度**：**阶段一（F0 工程化基础）已完成**。Monorepo 改造、后端骨架、WebSocket 联通均已完成；前端通过 WebSocket 接收实时事件，Session Store 由事件驱动，TopNav 显示连接状态。

### ✅ 已完成

| 模块 | 关键文件 | 备注 |
|------|----------|------|
| 核心类型 | `packages/shared-types/src/index.ts` | `AgentSession` / `ServerMessage` / `ClientMessage` 等 |
| pnpm Monorepo | `pnpm-workspace.yaml` | apps/* + packages/* |
| Fastify 后端骨架 | `apps/server/src/index.ts` | port 3001，REST + WebSocket，含状态机校验 |
| WebSocket Hook | `apps/web/src/hooks/useWebSocket.ts` | 指数退避自动重连，最多 10 次 |
| Session Store | `apps/web/src/stores/session-store.ts` | WebSocket 事件驱动，addSession/approve 调后端 API |
| 连接状态指示器 | `apps/web/src/components/layout/TopNav.tsx` | 绿/黄脉冲/橙/红，断线计时 |
| 无限画布 | `apps/web/src/components/canvas/` | 基于 `@xyflow/react`，节点可拖动 |
| 看板 | `apps/web/src/components/kanban/` | 基于 `@dnd-kit`，列间拖拽 |
| 会话详情 / 终端 | `apps/web/src/components/session/` | 终端面板仍为 Mock 输出（xterm.js 待接入） |
| 指挥中心 | `apps/web/src/components/command-center/` | 广播调后端 `/broadcast` API |
| 创建会话弹窗 | `apps/web/src/components/create-session/` | 含 agentType 选择（claude/aider/shell） |

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

> 📌 **无** — 等待分配（下一步建议：F1 会话管理 CRUD）

---

## 关键约定（Agent 必读）

### 目录结构（当前实际）
```
akari/
├── apps/
│   ├── server/src/
│   │   └── index.ts               # ✅ Fastify 入口，端口 3001
│   └── web/src/
│       ├── components/            # ✅ 全部前端组件
│       ├── stores/session-store.ts  # ✅ WebSocket 驱动
│       ├── hooks/useWebSocket.ts  # ✅ 自动重连
│       └── types/index.ts         # 重新导出 @akari/shared-types
└── packages/shared-types/src/     # ✅ 前后端共享类型
    └── index.ts
```

### WebSocket 事件协议（前后端约定）

| 事件名 | 方向 | Payload 关键字段 |
|--------|------|-----------------|
| `session:created` | S→C | `session: AgentSession` |
| `session:status` | S→C | `id, status, progress` |
| `terminal:data` | S→C | `sessionId, data: string` |
| `terminal:input` | C→S | `sessionId, data: string` |
| `diff:update` | S→C | `sessionId, diff: GitDiff` |
| `approval:required` | S→C | `sessionId, request: ApprovalRequest, diff` |
| `approval:decision` | C→S | `sessionId, decision: 'approved' \| 'rejected'` |
| `broadcast:send` | C→S | `message: string, targets?: string[]` |

### AgentAdapter 接口（后端实现标准）
```typescript
interface AgentAdapter {
  start(task: string, cwd: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  sendMessage(msg: string): Promise<void>;
  onCheckpoint(callback: CheckpointHandler): void;
}
```

### Checkpoint 标记格式（终端输出解析）
```
[CHECKPOINT] <描述>
[APPROVAL_REQUIRED] type=destructive command="<命令>"
[APPROVAL_REQUIRED] type=merge-ready
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
| `node-pty` Windows 需 VC++ Build Tools | F3 开发环境 | 优先在 WSL2 / macOS 开发；Windows 降级用 `child_process.spawn` |
| xterm.js + React 18 Strict Mode 双重挂载 | F3 内存泄露 | `useRef` 保护初始化，`useEffect` 返回 `dispose()` |
| Monaco Editor 包体积 ~2MB | F4 首屏性能 | 动态 `import()` 懒加载，仅审批弹窗打开时加载 |
| ~~`.agent-worktrees/` 未加入 `.gitignore`~~ | ~~F2 误提交~~ | ✅ 已在 `.gitignore` 中添加 |

---

## 如何接手一个模块

1. 阅读 `docs/设计文档.md` 对应章节（含代码示例）
2. 确认**前置依赖**模块已完成（见上方表格）
3. 在本文件「当前正在进行」一栏填写模块编号和负责人
4. 完成后更新上方「✅ 已完成」表格，清空「当前正在进行」
