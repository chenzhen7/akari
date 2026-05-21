# 看板视图模块设计

> 对应功能模块 **F0（看板视图）**，依赖 `shared-types`、`session-store`。

## UI 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  📋 看板视图                                          [+ 新建任务]    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                        │
│  BACKLOG(2)    IN-PROGRESS(3)   WAITING-REVIEW(2)   DONE(1)          │
│  ──────────    ──────────────   ───────────────────   ────────        │
│  ┌──────────┐  ┌──────────┐    ┌──────────┐          ┌──────────┐   │
│  │feat/cache│  │feat/auth │    │feat/pay  │          │feat/log  │   │
│  │○ Pending │  │🟢 67%    │    │⏸ 待审批  │          │✅ Merged │   │
│  │[启动]    │  │[查看]    │    │[批准][否] │          │[查看PR]  │   │
│  └──────────┘  └──────────┘    └──────────┘          └──────────┘   │
│                                                                        │
│  [批量批准 Waiting] [全部暂停] [导出报告]                              │
└──────────────────────────────────────────────────────────────────────┘
```

## 列定义

| 列 ID | 显示名 | 允许拖入的状态 |
|-------|--------|--------------|
| `backlog` | BACKLOG | `initializing` |
| `in-progress` | IN-PROGRESS | `running` / `paused` |
| `waiting-review` | WAITING-REVIEW | `waiting` / `review` |
| `approved` | APPROVED | `approved` |
| `done` | DONE | `completed` / `merged` |

## 拖拽行为

- 使用 `@dnd-kit/core` + `@dnd-kit/sortable`
- 卡片拖入新列时调用 `moveToColumn(id, column)`，同时调用后端 `PATCH /sessions/:id/status`
- 仅允许**合法状态转换**（由后端 SessionManager 校验），非法拖拽前端弹 toast 提示

## KanbanCard 组件

```typescript
interface KanbanCardProps {
  session: AgentSession;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  onOpen:    (id: string) => void;
}
```

- `waiting-review` 列卡片显示「批准 / 拒绝」按钮
- `in-progress` 列卡片显示进度条 + 「查看」按钮
- `done` 列卡片显示「查看 PR」（链接到 Git 合并记录）

## 关键实现要点

- 列表使用 `SortableContext`，列之间用 `DndContext` 包裹
- 拖拽结束事件 `onDragEnd` 中判断跨列移动，发起状态更新
- WebSocket `session:status` 事件推入时自动移动卡片列，**与画布视图共享同一 store**
- 底部操作栏「批量批准 Waiting」调用 `batchApprove()`（见 `approval-workflow` 模块）
