# 阶段六：Git 可视化 + 会话布局重构

**状态**：🔲 待开始 | **预计工时**：3~4 天 | **前置**：阶段二（WorktreeManager）、阶段三（前端框架）

---

## 概述

本阶段完成两件事：

1. **会话详情布局重构**：将终端从底部 40% 小条提升为主屏核心区域，左侧折叠侧边栏放置任务信息和 Git 操作，标签页切换 Terminal / Git Graph / Diff。
2. **Git Graph 可视化**：基于 `@gitgraph/react`（`@gitgraph/js` 的 React 绑定），在专属面板中渲染真实的分支/合并连线图，并提供 Commit、Merge 等基础 Git 操作入口。

---

## 6.1 会话详情布局重构

### 6.1.1 目标布局

```
┌──────────────────────────────────────────────────────────────────┐
│  Header：[← 返回]  会话名  状态徽章                              │
├──────────────────┬───────────────────────────────────────────────┤
│  Left Sidebar    │  Main Area                                    │
│  (默认 280px,    │                                               │
│   可折叠/展开)   │  Tab 切换栏：[● Terminal] [⎇ Git Graph] [± Diff]│
│                  │  ─────────────────────────────────────────── │
│  ▸ 任务描述      │                                               │
│  ▸ 状态 / 分支   │   当前激活面板内容（占满剩余高度）            │
│  ▸ 变更文件列表  │   Terminal / GitGraph / DiffViewer            │
│                  │                                               │
│  ──────────────  │                                               │
│  Git 操作区      │                                               │
│  [Commit]        │                                               │
│  [Merge Branch]  │                                               │
│  [Checkout]      │                                               │
│                  │                                               │
│  ──────────────  │                                               │
│  危险操作区      │                                               │
│  [归档] [删除]   │                                               │
└──────────────────┴───────────────────────────────────────────────┘
```

### 6.1.2 实现要点

- **拆分组件**
  - `SessionDetail.tsx`：外层骨架，仅负责 Header + 两列布局
  - `SessionSidebar.tsx`：左侧边栏，包含 TaskPanel 内容 + Git 操作按钮区
  - 主区域内联标签页（无需 shadcn `Tabs`，自实现 state 切换，减少嵌套）

- **可拖拽分割线**（可选，优先级 P2）
  使用 shadcn/ui 的 `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle`（基于 `react-resizable-panels`），实现左侧边栏宽度可拖拽。

- **侧边栏折叠**
  Header 区增加一个 `[⌘]` 按钮切换侧边栏 `open/collapsed`（`w-0 overflow-hidden` 动画）。折叠时主区域占满全宽，终端进一步扩大。

- **Terminal 面板**
  激活时占满 `Main Area` 全部高度（`flex-1 overflow-hidden`），`TerminalPanel` 逻辑不变。

### 6.1.3 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/session/SessionDetail.tsx` | **重写** |
| `apps/web/src/components/session/SessionSidebar.tsx` | **新建**（从 TaskPanel 剥离，增加 Git 操作区） |
| `apps/web/src/components/session/TaskPanel.tsx` | 保留核心逻辑，移除布局包装 |

---

## 6.2 后端 Git Log API

### 6.2.1 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/sessions/:id/git-log` | 获取该会话 worktree 的 git log（含所有分支） |
| `GET` | `/sessions/:id/git-branches` | 获取分支列表（本地 + remote） |
| `POST` | `/sessions/:id/git/commit` | 暂存所有变更并提交（body: `{message}`） |
| `POST` | `/sessions/:id/git/merge` | 合并指定分支（body: `{sourceBranch}`，走审批流） |
| `POST` | `/sessions/:id/git/checkout` | 切换分支（body: `{branch, createNew?: boolean}`） |

### 6.2.2 `GET /sessions/:id/git-log` 返回结构

```typescript
interface GitCommit {
  hash: string;          // 完整 SHA
  shortHash: string;     // 前 7 位
  message: string;       // commit message（首行）
  author: string;
  email: string;
  date: string;          // ISO 8601
  parents: string[];     // 父 commit hash 数组（merge commit 有 2 个）
  refs: string[];        // ["HEAD", "agent/task-abc12345", "origin/main"] 等
}

interface GitLogResponse {
  commits: GitCommit[];
  branches: { name: string; commit: string; isCurrent: boolean }[];
  head: string;          // 当前 HEAD commit hash
}
```

### 6.2.3 实现方式

在 `WorktreeManager` 中添加 `getGitLog(sessionId, limit = 100)` 方法，使用 `simple-git` 的 `log` API：

```typescript
const log = await git.log([
  '--all',
  '--topo-order',
  `--max-count=${limit}`,
  '--format=%H|%h|%s|%an|%ae|%aI|%P|%D',
]);
```

解析 `%D`（decorations）字段提取 `refs`；解析 `%P`（parents）字段提取 `parents[]`。

### 6.2.4 WebSocket 实时推送

文件变更（chokidar 已监听）触发 `diff:update` 时，**同时推送 `git:log-updated`** 事件：

```typescript
// packages/shared-types/src/index.ts 新增
interface GitLogUpdatedPayload {
  sessionId: string;
  commits: GitCommit[];
  branches: GitLogResponse['branches'];
  head: string;
}
```

---

## 6.3 前端 Git Graph 可视化

### 6.3.1 依赖安装

```bash
pnpm --filter @akari/web add @gitgraph/react @gitgraph/core
```

> `@gitgraph/react` 是 `@gitgraph/js`（即 `@gitgraph/core`）的官方 React 绑定，使用 `<Gitgraph>` 组件渲染 SVG。

### 6.3.2 核心挑战：Git Log → Gitgraph 命令序列

`@gitgraph/react` 的 API 是**命令式**的（先创建分支，再按顺序 commit），而真实 git log 是**历史数据**。需要一个转换算法（`gitLogToGraph`）：

#### 算法步骤（Lane Assignment）

```
输入：GitCommit[]（按 topo-order，从新到旧）

1. 建立 commitMap：hash → GitCommit
2. 从 refs 中提取所有分支头（branch heads），确定"分支名 → 初始 commit"映射
3. 按 topo-order 反向遍历（从旧到新），为每个 commit 分配"所属 lane（列）"：
   - 若 commit 是某分支 HEAD，分配新 lane
   - 若 commit 只有一个子 commit，继承子 commit 的 lane
   - 若 commit 是 merge commit（parents.length >= 2），将父分支 lane 合并
4. 生成 gitgraph 调用序列：
   - 按 lane 创建 branch 对象
   - 按时间序 commit
   - merge commit 时调用 branch.merge(otherBranch)
```

#### 实现文件

```
apps/web/src/lib/git-log-to-graph.ts   # 转换算法
apps/web/src/components/git/           # Git 相关组件目录
  GitGraphPanel.tsx                    # 主面板，调用 API + 渲染
  GitCommitTooltip.tsx                 # commit hover 详情弹出
  GitBranchBadge.tsx                   # 分支标签样式组件
```

### 6.3.3 `GitGraphPanel.tsx` 骨架

```tsx
import { Gitgraph } from '@gitgraph/react';

export function GitGraphPanel({ sessionId }: { sessionId: string }) {
  const [logData, setLogData] = useState<GitLogResponse | null>(null);

  // 初始加载 + git:log-updated 事件订阅
  useEffect(() => { /* fetch /sessions/:id/git-log */ }, [sessionId]);
  useEffect(() => { /* subscribe git:log-updated via terminalBus or sessionStore */ }, [sessionId]);

  return (
    <div className="h-full overflow-auto bg-background p-4">
      {logData ? (
        <Gitgraph>
          {(gitgraph) => {
            const commands = gitLogToGraph(logData);
            commands.forEach(cmd => cmd(gitgraph));
          }}
        </Gitgraph>
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
          加载 Git 历史...
        </div>
      )}
    </div>
  );
}
```

### 6.3.4 视觉要求

| 要求 | 实现方式 |
|------|----------|
| 分支颜色区分 | `@gitgraph/react` 默认自动分配颜色，可通过 `options.theme` 自定义 |
| 分支合并连线 | merge commit 时 `branch.merge(otherBranch)` 自动绘制弧线 |
| 当前 HEAD 标记 | commit 上渲染 `HEAD` ref badge，高亮当前 commit |
| Hover 显示详情 | 重写 `renderDot` + `renderTooltip` 自定义样式 |
| 暗色主题适配 | 自定义 `GitgraphUserApi` options 覆盖颜色 |
| 滚动 | 外层容器 `overflow-auto`，图形横向/纵向均可滚动 |

---

## 6.4 Git 基础操作 UI

### 6.4.1 Commit 操作

**触发**：点击侧边栏「提交」按钮  
**弹窗**（`GitCommitDialog.tsx`）：
- 暂存文件列表（勾选框，默认全选）
- commit message 输入框（required）
- [提交] / [取消]
- 调用 `POST /sessions/:id/git/commit`，成功后触发 `git:log-updated`

### 6.4.2 Merge 操作

**触发**：点击侧边栏「合并分支」按钮  
**弹窗**（`GitMergeDialog.tsx`）：
- 源分支选择下拉（从 `/sessions/:id/git-branches` 获取）
- Merge 类型：`--no-ff`（保留合并提交，默认）或 `--ff-only`
- [合并] → 进入**审批流**（`approval:required` 事件，因为 merge 属于破坏性操作）
- [取消]

> ⚠️ Merge 操作**必须走审批流**，不得直接执行，遵守核心原则 4。

### 6.4.3 Checkout 操作

**触发**：在 Git Graph 中**右键点击**某个 commit 或分支标签  
**上下文菜单**（`GitContextMenu.tsx`）：
- 「切换到此分支」→ `POST /sessions/:id/git/checkout`
- 「从此提交创建新分支」→ 弹出分支名输入框
- 「复制 commit hash」→ 写剪贴板
- 「查看 diff」→ 切换到 Diff 标签并高亮该 commit 的变更（P2）

### 6.4.4 涉及文件

```
apps/web/src/components/git/
  GitCommitDialog.tsx
  GitMergeDialog.tsx
  GitContextMenu.tsx
apps/web/src/components/session/SessionSidebar.tsx  # Git 操作区按钮
```

---

## 6.5 共享类型扩展

在 `packages/shared-types/src/index.ts` 中新增：

```typescript
export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
  refs: string[];
}

export interface GitBranch {
  name: string;
  commit: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitLogResponse {
  commits: GitCommit[];
  branches: GitBranch[];
  head: string;
}

// ServerMessage 新增 event 类型
// type: 'git:log-updated', payload: { sessionId: string } & GitLogResponse
```

---

## 6.6 实现顺序（推荐）

```
Step 1  共享类型扩展（packages/shared-types）         ~0.5h
Step 2  后端 WorktreeManager.getGitLog()              ~1h
Step 3  后端新增 REST 端点 + WebSocket 推送            ~1h
Step 4  会话详情布局重构（SessionDetail + SessionSidebar）~2h
Step 5  gitLogToGraph 转换算法                        ~3h
Step 6  GitGraphPanel 组件渲染                        ~2h
Step 7  Git 操作弹窗（Commit / Merge / Checkout）     ~3h
Step 8  联调 + 暗色主题适配                           ~1h
```

---

## 验收清单

### L1 布局重构

| # | 步骤 | 预期结果 |
|---|------|---------|
| L1-1 | 打开任意会话详情 | 左侧边栏显示任务信息 + Git 操作按钮；右侧主区默认激活 Terminal 标签 |
| L1-2 | Terminal 标签下拖拽窗口 | 终端高度占满主区全部（约 80%+ 屏幕高度），不再挤在底部 40% |
| L1-3 | 点击 Header 折叠按钮 | 左侧边栏滑入折叠，主区宽度扩展到 100%，终端进一步变宽 |
| L1-4 | 点击主区 [Git Graph] 标签 | 切换到 Git Graph 面板，Terminal 状态保留（xterm 实例不销毁） |
| L1-5 | 点击主区 [Diff] 标签 | 切换到 DiffViewer，已有 diff 内容正常展示 |

### L2 Git Graph 可视化

| # | 步骤 | 预期结果 |
|---|------|---------|
| G1 | 进入 Git Graph 标签 | 加载完成后渲染 SVG 分支图，每个 commit 显示为圆点 + 短 hash + message |
| G2 | 存在多分支历史 | 不同分支以不同颜色显示，合并点有弧线连接（类 VSCode Git Graph） |
| G3 | commit 上悬停 | 弹出 Tooltip 显示：完整 hash / 作者 / 时间 / message |
| G4 | 当前 HEAD commit | 高亮标记或附带 `HEAD` 标签 |
| G5 | 在 worktree 中做新 commit | 1~2s 内 Git Graph 自动刷新（WebSocket `git:log-updated` 驱动） |

### L3 Git 操作

| # | 步骤 | 预期结果 |
|---|------|---------|
| O1 | 修改 worktree 文件后点击「提交」 | 弹出 Commit 弹窗，显示变更文件列表 |
| O2 | 填写 message，点击「提交」 | 弹窗关闭，Git Graph 刷新出新 commit 节点 |
| O3 | 点击「合并分支」 | 弹出 Merge 弹窗，可选择源分支，确认后进入审批流（TopNav 角标闪烁） |
| O4 | 在 Git Graph 右键某分支标签 | 上下文菜单出现「切换到此分支」「复制 hash」等选项 |

---

## 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `@gitgraph/react` 对复杂 rebase/octopus merge 历史支持有限 | G2 复杂分支可能渲染异常 | 第一版限制 `--max-count=50`，超出截断；复杂场景 fallback 到线性列表 |
| `gitLogToGraph` lane 分配算法复杂度 | 开发工时风险 | 优先实现 2 分支场景；多分支迭代完善 |
| `react-resizable-panels` 与 xterm.js 的 `FitAddon` 冲突 | L1-2 终端尺寸计算错误 | resize 完成后手动触发 `fitAddon.fit()` + debounce 100ms |
| Merge 操作在 Windows worktree 路径含空格时 simple-git 报错 | O3 失败 | worktree 路径已使用 session ID（纯字母数字），通常无空格 |
