# 阶段四：审批工作流

**状态**：🔲 待开始 | **预计工时**：1~2 天 | **前置**：阶段三

---

## 4.1 后端审批流

文件：`apps/server/src/approval-workflow.ts`

- [ ] `requestApproval(sessionId, request)` — 挂起 Agent，推送 `approval:required` 事件
- [ ] `handleApproval(sessionId, 'approved' | 'rejected')` — 恢复/暂停 Agent
- [ ] `batchApprove(sessionIds[])` — 批量审批
- [ ] 审批超时机制（超时自动拒绝，可配置）
- [ ] 审批记录写入 SQLite

> **禁止**：Agent 适配器不得自动回复 `y\n`，必须经过 `handleApproval` 接口。

## 4.2 前端审批 UI

- [ ] `approval:required` 事件触发 CommandCenter 审批队列更新
- [ ] 审批弹窗：展示危险命令 / merge diff，批准 / 拒绝操作
- [ ] TopNav 审批角标（待审批数量）
- [ ] 批量审批按钮（CommandCenter 面板）
