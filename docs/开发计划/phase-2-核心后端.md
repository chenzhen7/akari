# 阶段二：核心后端模块

**状态**：✅ 已完成 | **预计工时**：3~5 天 | **前置**：阶段一 ✅

---

## 2.1 WorktreeManager

文件：`apps/server/src/worktree-manager.ts`

- [x] `createWorktree(sessionId, baseBranch)` — 创建 Git Worktree + 新分支
- [x] `removeWorktree(sessionId, worktreePath, branchName?)` — 清理 Worktree
- [x] `getDiff(sessionId, baseBranch, cwd?)` — 获取与 baseBranch 的 diff（stat + full）
- [x] `watchDiff(sessionId, baseBranch, callbacks)` — chokidar 监听文件变更，实时推送 diff 与文件变更事件
- [x] `commitAll(sessionId, message, cwd?)` / `mergeToBase(sessionId, sourceBranch?)` / `checkoutBranch(...)` / `discardAll(...)` / `discardFile(...)` — Git 操作
- [x] 依赖隔离：`node_modules` 软链复用
- [x] 分支命名规范：`agent/<sessionId前8位>`
- [x] Worktree 根目录：`<worktreeBaseDir>/<repoSlug>/<sessionId>/`（默认 `<repo>/.agent-worktrees/<repoSlug>/<sessionId>/`）

---

## 2.2 TerminalMultiplexer

文件：`apps/server/src/terminal-mux.ts`

- [x] `createTerminal(terminalId, sessionId, cwd)` — node-pty 创建 PTY 进程
- [x] `sendToTerminal(terminalId, data)` — 向终端写入
- [x] `resizeTerminal(terminalId, cols, rows)` — 调整终端尺寸
- [x] `broadcastToAll(data, terminalIds?)` — 广播给多个终端
- [x] `getBuffer(terminalId)` — 输出捕获 + 环形 Buffer（保留最近 5000 行）
- [x] `killTerminal(terminalId)` — 终止 PTY
- [x] 事件发射：`terminal:data`、`terminal:ready`、`terminal:resized`、`terminal:exit`

> **历史说明**：早期版本包含 `detectMarkers()` 解析 `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 魔法字符串，该机制已在 Phase 8 中完全删除，TerminalMultiplexer 现仅负责 PTY 生命周期管理。

---

## 2.3 SessionManager

文件：`apps/server/src/session-manager.ts`

- [x] `createSession(params)` — 协调 WorktreeManager + TerminalMultiplexer
- [x] `updateStatus(sessionId, status)` — 状态机转换（含 `validateTransition()` 合法路径校验）
- [x] `getSession(sessionId)` / `listSessions()` — 查询接口
- [x] SQLite 持久化（better-sqlite3），服务重启后会话可恢复
- [x] 标签管理：`createTab` / `closeTab` / `activateTab` / `reorderTabs`
- [x] 归档/恢复：`archiveSession` / `restoreSession`

**会话状态机**：
```
initializing ──→ idle ───────────────→ running
    │              │                      │
    │              ├──→ paused ──────────┤
    │              │         └──────── waiting
    │              │                      │
    │              ├──→ failed           ├──→ completed ──→ merged
    │              │                      │
    │              └──→ archived         └──→ archived
    │
    └──→ failed
```

合法转移表：

| 当前状态 | 可转移到 |
|----------|----------|
| initializing | idle, failed |
| idle | running, failed, archived |
| running | idle, waiting, paused, completed, failed, archived |
| waiting | running, paused, failed, archived |
| approved | running, archived |
| paused | running, waiting, failed, archived |
| review | completed, running, archived |
| completed | merged, archived, running |
| failed | archived, running |
| merged | archived |
| archived | paused |

---

## 依赖安装

```bash
# apps/server
pnpm add node-pty simple-git chokidar better-sqlite3 execa
pnpm add -D @types/better-sqlite3
```
