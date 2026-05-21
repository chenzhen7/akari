# 共享类型模块设计

> 前后端共享的核心类型定义，编译后以 npm 包形式被 `apps/web` 和 `apps/server` 引用。  
> 文件位置：`packages/shared-types/src/index.ts`

## 核心实体

```typescript
// AgentSession — 会话完整模型
interface AgentSession {
  id: string;
  name: string;
  status: SessionStatus;
  task: string;

  // Git 相关
  worktreePath: string;    // <repo>/.agent-worktrees/<sessionId>
  branchName: string;      // agent/<taskName>-<sessionId前8位>
  baseBranch: string;      // 通常为 main

  // 画布坐标（前端持久化）
  canvasPosition: { x: number; y: number };
  canvasSize:     { width: number; height: number };

  // 看板
  kanbanColumn: KanbanColumn;

  // 终端
  terminalId: string;

  // 审批
  pendingApproval?: ApprovalRequest;

  // 元数据
  createdAt: Date;
  tags: string[];
  agentType: 'claude' | 'aider' | 'shell';
}

type SessionStatus =
  | 'initializing'   // 创建 worktree 中
  | 'running'        // Agent 执行中
  | 'waiting'        // 等待用户审批
  | 'paused'         // 手动暂停
  | 'review'         // 代码审查中
  | 'approved'       // 已批准，即将继续
  | 'completed'      // 执行完成
  | 'failed'         // 执行失败
  | 'merged';        // 已合并到主分支

type KanbanColumn =
  | 'backlog'
  | 'in-progress'
  | 'waiting-review'
  | 'approved'
  | 'done';
```

## 审批相关

```typescript
interface ApprovalRequest {
  type: 'checkpoint' | 'destructive-op' | 'merge-ready';
  message: string;
  diff?: GitDiff;
  command?: string;   // destructive-op 时填写
  timestamp: Date;
}
```

## Git Diff

```typescript
interface GitDiff {
  stat: string;       // git diff --stat 原始输出
  fullDiff: string;   // git diff 原始输出
  files: DiffFile[];
  summary: { additions: number; deletions: number; files: number };
}

interface DiffFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';   // Added / Modified / Deleted / Renamed
  additions: number;
  deletions: number;
}
```

## WebSocket 消息类型

```typescript
// 服务端 → 客户端
type ServerMessage =
  | { event: 'session:created';  payload: AgentSession }
  | { event: 'session:status';   payload: { id: string; status: SessionStatus; progress: number } }
  | { event: 'terminal:data';    payload: { sessionId: string; data: string } }
  | { event: 'diff:update';      payload: { sessionId: string; diff: GitDiff } }
  | { event: 'approval:required'; payload: { sessionId: string; request: ApprovalRequest; diff: GitDiff } };

// 客户端 → 服务端
type ClientMessage =
  | { event: 'terminal:input';    payload: { sessionId: string; data: string } }
  | { event: 'approval:decision'; payload: { sessionId: string; decision: 'approved' | 'rejected' } }
  | { event: 'broadcast:send';    payload: { message: string; targets?: string[] } };
```

## 状态转换合法路径

```
initializing → running
running      → waiting | paused | completed | failed
waiting      → running（approved）| paused（rejected）
paused       → running
completed    → merged
```

> 后端 `SessionManager` 必须校验状态转换合法性，非法转换抛出错误。
