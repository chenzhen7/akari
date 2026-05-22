# 阶段二：核心后端模块

**状态**：🔲 待开始 | **预计工时**：3~5 天 | **前置**：阶段一 ✅

---

## 2.1 WorktreeManager

文件：`apps/server/src/worktree-manager.ts`

- [ ] `createWorktree(sessionId, taskName, baseBranch)` — 创建 Git Worktree + 新分支
- [ ] `removeWorktree(sessionId)` — 清理 Worktree
- [ ] `getDiff(sessionId)` — 获取与 baseBranch 的 diff（stat + full）
- [ ] `watchDiff(sessionId, cb)` — chokidar 监听文件变更，实时推送 diff
- [ ] `mergeToBase(sessionId, strategy)` — squash/merge/rebase 合并策略
- [ ] 依赖隔离：`node_modules` 软链复用
- [ ] 分支命名规范：`agent/<taskName>-<sessionId前8位>`
- [ ] Worktree 根目录：`<repo>/.agent-worktrees/<sessionId>/`

## 2.2 TerminalMultiplexer

文件：`apps/server/src/terminal-mux.ts`

- [ ] `createTerminal(sessionId, cwd)` — node-pty 创建 PTY 进程
- [ ] `sendToTerminal(sessionId, data)` — 向终端写入
- [ ] `broadcastToAll(data, targets?)` — 广播给多个终端
- [ ] 输出捕获 + 环形 Buffer（保留最近 5000 行）
- [ ] Checkpoint 检测：`/\[CHECKPOINT\] (.+)/`
- [ ] 审批请求检测：`/\[APPROVAL_REQUIRED\] (.+)/`
- [ ] 事件发射：`terminal:data`、`approval:required`、`checkpoint:reached`

## 2.3 SessionManager

文件：`apps/server/src/session-manager.ts`

- [ ] `createSession(params)` — 协调 WorktreeManager + TerminalMultiplexer
- [ ] `updateStatus(sessionId, status)` — 状态机转换（含合法路径校验）
- [ ] `getSession(sessionId)` / `listSessions()` — 查询接口
- [ ] SQLite 持久化（better-sqlite3），服务重启后会话可恢复

**会话状态机**：
```
initializing → running → waiting → approved → running → completed → merged
                       ↘ rejected → paused → running（可恢复）
                                           ↘ failed
```

---

## 依赖安装

```bash
# apps/server
pnpm add node-pty simple-git chokidar better-sqlite3 execa fs-extra
pnpm add -D @types/better-sqlite3
```
