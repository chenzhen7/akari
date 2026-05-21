# 指挥中心面板模块设计

> 对应功能模块 **F5（审批工作流-前端）**。  
> 依赖后端：`approval-workflow`（WebSocket `approval:required` / `approval:decision`）。

## UI 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  🎯 指挥中心面板                                                       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                        │
│  📡 广播消息（发送给所有/选中的 Agent）                                 │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ 所有模块请统一使用 TypeScript strict mode，并添加单元测试      │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  接收者: [全部✓] [feat/auth] [feat/pay] [feat/api]  [广播发送]        │
│                                                                        │
│  ⏸ 待审批队列 (2个)                          [全部批准] [全部拒绝]    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ feat/payment  │ 准备执行: rm -rf dist/  │ [批准] [拒绝] [查看] │   │
│  │ feat/ui-comp  │ 合并就绪: +445 -23     │ [批准] [拒绝] [查看] │   │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  📊 总览                                                               │
│  Running: 3  │  Waiting: 2  │  Done: 1  │  Failed: 1  │  Total: 7   │
└──────────────────────────────────────────────────────────────────────┘
```

## 三大功能区

### 1. 广播区

- 文本输入框 + 接收者多选（Checkbox，默认全选）
- 发送后调用 WebSocket `broadcast:send { message, targets?: string[] }`
- 后端 `TerminalMultiplexer.broadcastToAll()` 将消息写入目标终端

### 2. 审批队列

- 监听 WebSocket `approval:required` 事件，推入队列（Zustand store）
- 每条审批项显示：会话名、审批类型（危险命令 / 合并就绪）、简要描述
- **批准**：发送 `approval:decision { sessionId, decision: 'approved' }`
- **拒绝**：发送 `approval:decision { sessionId, decision: 'rejected' }`
- **查看**：打开该会话 Tab，并展开完整 Diff（Monaco Diff Editor）
- **全部批准**：调用后端 `batchApprove(sessionIds)`

### 3. 统计总览

- 从 session-store 派生，实时统计各状态数量
- 无需单独 API，纯前端计算

## TopNav 角标

- 待审批数量 > 0 时，TopNav 指挥中心按钮显示红色数字角标
- 数据来源：`pendingApprovals.length`（store 中维护）

## Store 扩展

```typescript
// session-store 需新增
interface SessionStore {
  pendingApprovals: ApprovalRequest[];  // 审批队列
  addPendingApproval: (req: ApprovalRequest) => void;
  removePendingApproval: (sessionId: string) => void;
}
```

## 关键实现要点

- `CommandCenter` 以抽屉（Sheet）形式覆盖，不影响后方视图
- 「全部批准」需二次确认弹窗（危险操作不可批量静默通过）
- 广播消息历史记录保存最近 20 条（session storage，非持久化）
