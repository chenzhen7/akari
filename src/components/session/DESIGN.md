# 会话详情 / Tab + 终端视图模块设计

> 对应功能模块 **F3（终端多路复用-前端）** + **F4（实时 Diff-前端）**。  
> 依赖后端：`terminal-mux`（WebSocket `terminal:data`）、`worktree-manager`（WebSocket `diff:update`）。

## UI 布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  [画布] [看板] │ feat/auth ✕ │ feat/pay ✕ │ feat/api ✕ │ [+]       │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                        │
│  ┌─────────────────────────────┬──────────────────────────────────┐  │
│  │  📝 任务描述                 │  🔄 Git Diff                     │  │
│  │  实现用户认证模块             │  src/auth/login.ts    +45 -3    │  │
│  │  - JWT token 管理            │  src/auth/jwt.ts      +89 -0    │  │
│  │  - OAuth 集成                │                                  │  │
│  │  状态: 🟢 Running (67%)     │  [展开详情] [复制Diff]           │  │
│  │  Branch: feat/user-auth     │                                  │  │
│  └─────────────────────────────┴──────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  💻 终端                                    [清空] [暂停] [复制] │ │
│  │  $ claude --continue                                             │ │
│  │  > Implementing JWT validation middleware                         │ │
│  │  > ████████░░ 4/5 tests passing                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  💬 向此 Agent 发送消息                              [发送]      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## 文件结构

```
session/
├── SessionDetail.tsx   # 容器：Tab 栏 + 三区域布局
├── TaskPanel.tsx       # 左上：任务描述 + 状态 + 分支信息
└── TerminalPanel.tsx   # 下方：xterm.js 终端 + 消息输入框
```

`DiffViewer.tsx` 单独放在 `components/diff/`，由 `TaskPanel` 右侧区域引用。

## 终端实现（xterm.js）

```typescript
// TerminalPanel.tsx
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

useEffect(() => {
  const term = new Terminal({ scrollback: 5000 });
  const fit  = new FitAddon();
  term.loadAddon(fit);
  term.open(containerRef.current!);
  fit.fit();

  // 接收后端推流
  const unsub = ws.on('terminal:data', ({ sessionId, data }) => {
    if (sessionId === session.id) term.write(data);
  });

  // 用户输入
  term.onData(data => ws.send('terminal:input', { sessionId: session.id, data }));

  return () => { unsub(); term.dispose(); };  // 必须 dispose，防止 Strict Mode 泄露
}, [session.id]);
```

> ⚠️ 用 `useRef` 保护 `term` 实例，避免 React 18 Strict Mode 双重挂载。

## Diff 视图实现（Monaco）

```typescript
// DiffViewer.tsx — 懒加载
const MonacoDiffEditor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.DiffEditor })));

// 接收 diff:update 推送
ws.on('diff:update', ({ sessionId, diff }) => {
  if (sessionId === session.id) setDiff(diff);
});
```

> ⚠️ Monaco 约 2MB，必须用 `lazy()` + `<Suspense>` 懒加载，不可同步 import。

## Props / 事件

| 动作 | 发送 WebSocket 事件 |
|------|-------------------|
| 用户输入文字 | `terminal:input { sessionId, data }` |
| 发送消息给 Agent | `terminal:input { sessionId, data: msg + '\n' }` |
| 清空终端 | 本地 `term.clear()`，不通知后端 |
| 暂停 Agent | `approval:decision { sessionId, decision: 'rejected' }` 或专用暂停 API |
