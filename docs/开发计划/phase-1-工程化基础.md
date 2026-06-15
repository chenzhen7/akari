# 阶段一：工程化基础

**状态**：✅ 已完成 | **预计工时**：1~2 天

---

## 1.1 Monorepo 改造

- [x] 将现有 `src/` 迁移到 `apps/web/`
- [x] 初始化 `apps/server/`（Fastify + TypeScript）
- [x] 创建 `packages/shared-types/`，迁移核心类型
- [x] 配置 `pnpm workspaces`，统一 `tsconfig`

## 1.2 后端骨架

文件：`apps/server/src/index.ts`

- [x] Fastify 服务启动（端口 3001）
- [x] WebSocket 插件（`@fastify/websocket`）
- [x] 基础路由：`GET /health`、`GET /sessions`、`POST /sessions`、`PATCH /sessions/:id/status`、`POST /sessions/:id/approval`、`POST /broadcast`
- [x] WebSocket 事件协议定义

## 1.3 前端接入 WebSocket

- [x] `apps/web/src/hooks/useWebSocket.ts`（指数退避自动重连，最多 10 次）
- [x] Session Store 改为 WebSocket 事件驱动
- [x] 连接状态指示器（TopNav 右侧，绿/黄/橙/红）

---

## WebSocket 事件协议

| 事件 | 方向 | Payload 关键字段 |
|------|------|-----------------|
| `session:created` | S→C | `session: AgentSession` |
| `session:status` | S→C | `id, status, progress` |
| `terminal:data` | S→C | `sessionId, data: string` |
| `terminal:input` | C→S | `sessionId, data: string` |
| `diff:update` | S→C | `sessionId, diff: GitDiff` |
| `approval:required` | S→C | `sessionId, request: ApprovalRequest, diff` |
| `approval:decision` | C→S | `sessionId, decision: 'approved' \| 'rejected'` |
| `broadcast:send` | C→S | `message: string, targets?: string[]` |
