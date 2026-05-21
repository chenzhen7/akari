# 无限画布模块设计

> 对应功能模块 **F0（画布视图）**，依赖 `shared-types`、`session-store`。

## UI 布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  🗺️ 无限画布                    [+新建会话] [全局暂停] [全局批准]    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                       │
│   ┌─────────────────┐      ┌─────────────────┐                      │
│   │ 🟢 Session-01   │      │ 🟡 Session-02   │                      │
│   │ feat/user-auth  │      │ feat/payment     │                      │
│   │─────────────────│      │─────────────────│                      │
│   │ ▶ Running       │      │ ⏸ Waiting Review│                      │
│   │ 进度: ████░░ 67%│      │ 进度: ██████ 100%│                     │
│   │─────────────────│      │─────────────────│                      │
│   │ > implementing  │      │ [查看 Diff]     │                      │
│   │   login flow... │      │ +234 -12 lines  │                      │
│   │─────────────────│      │─────────────────│                      │
│   │ [暂停] [查看]   │      │ [批准] [拒绝]   │                      │
│   └─────────────────┘      └─────────────────┘                      │
│                                                                       │
│  [缩放: 80%]  [适应屏幕]  [按状态分组]  [显示连接线]                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 状态颜色

| 状态 | 颜色 | Tailwind |
|------|------|----------|
| `running` | 绿色 | `#22c55e` |
| `waiting` | 黄色 | `#f59e0b` |
| `failed` | 红色 | `#ef4444` |
| `completed` | 紫色 | `#6366f1` |
| `paused` | 灰色 | `#6b7280` |

## Store 接口（Zustand）

```typescript
interface CanvasStore {
  sessions: Map<string, AgentSession>;
  nodes: Node[];           // ReactFlow nodes，由 sessions 派生
  edges: Edge[];           // 依赖关系连线（可选）

  viewMode: 'canvas' | 'kanban' | 'tab';

  addSession: (task: TaskDefinition) => Promise<void>;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  approveSession: (id: string) => Promise<void>;
  broadcastMessage: (msg: string, targets?: string[]) => void;
  updateCanvasPosition: (id: string, pos: { x: number; y: number }) => void;
}
```

## SessionNode 组件结构

```typescript
// SessionNode.tsx — ReactFlow 自定义节点
const SessionNode = ({ session }: { session: AgentSession }) => (
  <div className={`session-card status-${session.status}`}>
    <div className="card-header">
      <StatusDot color={statusColors[session.status]} />
      <span>{session.name}</span>
      <span className="branch">{session.branchName}</span>
    </div>

    <ProgressBar value={session.progress} />

    <TerminalMiniView sessionId={session.id} lines={5} />  {/* 迷你终端预览 */}

    <DiffSummary diff={session.latestDiff} />

    <div className="card-actions">
      {session.status === 'waiting' && (
        <>
          <Button variant="success" onClick={() => approve(session.id)}>批准</Button>
          <Button variant="danger"  onClick={() => reject(session.id)}>拒绝</Button>
        </>
      )}
      <Button onClick={() => openTab(session.id)}>详情</Button>
    </div>
  </div>
);
```

## 关键实现要点

- 使用 `@xyflow/react`，节点类型注册为 `sessionNode`
- 节点位置拖动结束后调用 `updateCanvasPosition`，同步到后端持久化
- WebSocket `session:status` 事件触发节点颜色实时更新，**不得 polling**
- `TerminalMiniView` 仅展示最后 5 行，滚动由父组件 `SessionDetail` 处理
- 节点数 > 20 时开启虚拟化（`@xyflow/react` `nodesDraggable` + 视口裁剪）
