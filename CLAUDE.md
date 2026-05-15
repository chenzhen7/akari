# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在本仓库中工作的指导。

## 项目概述

**Akari** 是一个 AI Agent 并行开发管理平台。完整的产品架构和需求文档见 [docs/设计文档.md](docs/设计文档.md)。目前代码库处于初始化阶段，是一个基于 Vite + React + shadcn/ui 的前端脚手架。规划中的架构包括：无限画布、看板视图、标签页会话视图、终端多路复用、Git worktree 管理以及 Agent 适配器（Claude、Aider 等）。

**核心理念：「指挥中心」模式**
- 用户是指挥官，Agent 是并行执行的士兵
- 无限画布 = 战场全局视图
- 看板 = 任务状态流转
- Tab = 快速聚焦单个战场
- Worktree = 物理隔离的并行战线

## 技术栈

```
前端: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
画布: @xyflow/react
看板: @dnd-kit/core
终端: xterm.js
状态: Zustand
Diff: Monaco Editor

后端: Node.js + Fastify
终端复用: node-pty
Git 操作: simple-git
文件监听: chokidar
通信: WebSocket
数据库: SQLite (better-sqlite3)
```

## 项目结构

```
akari/
├── apps/
│   ├── server/                # Node.js 后端 (Fastify + WebSocket)
│   │   ├── src/
│   │   │   ├── session-manager.ts
│   │   │   ├── worktree-manager.ts
│   │   │   ├── terminal-mux.ts
│   │   │   ├── approval-workflow.ts
│   │   │   └── agent-adapters/
│   │   └── package.json
│   └── web/                   # Web 前端 (React + Vite)
│       ├── components/
│       │   ├── Canvas/        # 无限画布 (ReactFlow)
│       │   ├── Kanban/        # 看板
│       │   ├── Terminal/      # 终端组件
│       │   ├── DiffViewer/    # Diff 展示
│       │   └── CommandCenter/ # 指挥中心面板
│       ├── stores/            # Zustand stores
│       └── hooks/
├── packages/
│   └── shared-types/          # 共享类型定义
└── package.json               # Monorepo (pnpm workspaces)
```

## 编码规范

### TypeScript
- 严格模式 (`strict: true`)
- 所有公共 API 必须显式标注返回类型
- 优先使用 `interface` 定义对象类型
- 使用类型守卫替代 `as` 断言

### React
- 函数组件 + Hooks
- Props 使用解构，命名规范：`ComponentNameProps`
- 状态管理使用 Zustand，避免深层 prop drilling
- 副作用集中放在自定义 Hooks 中

### 命名约定
- 文件: PascalCase (组件), camelCase (工具), kebab-case (配置)
- 变量: camelCase
- 常量: UPPER_SNAKE_CASE
- 类型/接口: PascalCase
- CSS 类: Tailwind 优先，复杂样式使用 `cn()` 工具函数


## Agent 集成协议

当实现 Agent 适配器时，必须支持以下协议：

```typescript
interface AgentAdapter {
  start(task: string, cwd: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  sendMessage(msg: string): Promise<void>;
  onCheckpoint(callback: CheckpointHandler): void;
}
```

**Checkpoint 标记约定**（通过终端输出解析）：
- 完成重要步骤：`[CHECKPOINT] <描述>`
- 需要执行危险操作：`[APPROVAL_REQUIRED] type=destructive command="<命令>"`
- 准备合并：`[APPROVAL_REQUIRED] type=merge-ready`

## Worktree 管理规范

所有 Git 操作必须通过 `WorktreeManager`：
- Worktree 基础目录：`<repo>/.agent-worktrees/<sessionId>/`
- 分支命名：`agent/<taskName>-<sessionId前8位>`
- 依赖隔离：通过符号链接复用 `node_modules`
- 清理：会话结束后必须调用 `removeWorktree()`

## 关键实现原则

1. **物理隔离优先**：每个 Agent 会话使用独立 worktree，禁止直接在主工作区操作
2. **状态驱动 UI**：所有视图（画布/看板/Tab）共享同一份会话状态，通过 Zustand 同步
3. **终端即真相**：Agent 的输出通过终端复用器捕获，不通过自定义协议通信
4. **审批不可绕过**：危险操作（ destructive ops ）必须经用户审批，Agent 适配器不得自动确认

## 开发任务优先级

1. 核心骨架：Worktree 管理 + 终端复用 + IPC
2. 视图系统：画布 + 看板 + Tab 联动
3. 审批工作流：Checkpoint 检测 + UI
4. Git 集成：实时 Diff + 合并
5. Agent 适配：Claude Code / Aider / 自定义

## 文档索引

- [docs/设计文档.md](docs/设计文档.md) - 完整产品架构、数据模型、视图设计