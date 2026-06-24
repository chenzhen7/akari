# 阶段六：Git 可视化 + 会话布局重构

**状态**：✅ 已完成（布局实现有差异） | **预计工时**：3~4 天 | **前置**：阶段二（WorktreeManager）、阶段三（前端框架）

> **说明**：Git Graph 可视化、Git Log API、Git 操作弹窗（Commit / Merge / Checkout / Discard）均已实现。实际会话详情布局采用 `MiddleTabBar` + `TabContent` 切换，而非本阶段原计划 Activity Bar 图标侧边栏；`SessionSidebar` 已拆分为 `SessionInfoPanel` / `TaskPanel` / `MiddleTabBar` / `TabContent` 等组件。

---

## 概述

本阶段完成两件事：

1. **会话详情布局重构**：将左侧 280px 宽侧边栏改造为 48px 图标侧边栏（Activity Bar），点击图标直接切换主内容区（Terminal / Git Graph / Diff / 任务信息），消除顶部 Tab 栏，让内容区域最大化。
2. **Git Graph 可视化升级**：参考 IntelliJ IDEA 的 Git Log 面板风格，实现带列头的表格式布局（分支图 + Message + Author + Date），点击 Commit 在底部弹出详情面板，支持右键上下文菜单。

---

## 6.1 会话详情布局重构（图标侧边栏）

### 6.1.1 目标布局

```
┌──────────────────────────────────────────────────────────────────┐
│  Header：[← 返回]  会话名  状态徽章  [Agent类型]                  │
├────┬─────────────────────────────────────────────────────────────┤
│    │                                                             │
│ ⌨  │                                                             │
│    │            主内容区（由激活图标决定）                         │
│ ⎇  │            Terminal / Git Graph / Diff / 任务信息           │
│    │                                                             │
│ ⌥  │                                                             │
│    │                                                             │
│ ──  │                                                             │
│    │                                                             │
│ ⚠  │                                                             │
│    │                                                             │
└────┴─────────────────────────────────────────────────────────────┘
```

**图标侧边栏（宽 48px）：**

| 位置 | 图标 | 功能 | 说明 |
|------|------|------|------|
| 上方 | `Terminal` | 终端 | 激活时高亮，切换到 TerminalPanel |
| 上方 | `GitBranch` | Git Graph | 切换到 GitGraphPanel |
| 上方 | `FileCode` | 变更 Diff | 切换到 DiffViewer，有变更时显示角标数 |
| 上方 | `Info` | 任务信息 | 切换到 SessionInfoPanel（任务描述 + 状态 + 分支 + Git操作 + 危险区） |
| 下方 | `Archive` | 归档 | 快捷按钮，二次确认后归档 |

- 图标按钮高 48px × 宽 48px，激活时左侧高亮边条（`border-l-2 border-primary`）+ 图标变亮
- 无文字标签（hover 时 Tooltip 显示名称），保持精简
- 危险操作（归档/删除）保留在 `SessionInfoPanel` 中；图标栏底部快捷归档仅用于快速操作

### 6.1.2 组件拆分

```
SessionDetail.tsx         ← 顶层：Header + 两列（图标栏 + 内容区）
  ActivityBar.tsx         ← 图标栏（48px 固定宽）
  SessionInfoPanel.tsx    ← 任务信息面板（从 SessionSidebar 重命名，移除布局包装）
  TerminalPanel.tsx       ← 不变
  GitGraphPanel.tsx       ← 升级（见 6.3）
  DiffViewer.tsx          ← 不变
```

- `SessionSidebar.tsx` → **重命名**为 `SessionInfoPanel.tsx`，内容不变，仅移除外层 `px-3 py-3` 布局
- `SessionDetail.tsx` 重写：去掉顶部 Tab 栏，图标栏 `activePanel` state 控制内容区显示
- 四个面板均用 `absolute inset-0` + `hidden/flex` 切换，Terminal 始终保持挂载（与现有逻辑一致）

### 6.1.3 涉及文件

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/session/SessionDetail.tsx` | **重写** |
| `apps/web/src/components/session/ActivityBar.tsx` | **新建** |
| `apps/web/src/components/session/SessionSidebar.tsx` | **重命名** → `SessionInfoPanel.tsx` |

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

## 6.3 前端 Git Graph 可视化（IDEA 风格升级）

无需额外依赖，基于现有自绘 SVG 方案升级（无 `@gitgraph/react`）。

### 6.3.1 目标视觉效果（参考 IntelliJ IDEA Git Log）

```
┌─────────────────────────────────────────────────────────────────┐
│  [分支过滤下拉 ▾]  [搜索提交...]          [刷新]               │
├──────────────────────┬───────────────────────┬────────┬─────────┤
│  图形 / 提交信息      │  Author               │  Date  │  Hash  │
├──────────────────────┼───────────────────────┼────────┼─────────┤
│ ●── ─ ─ HEAD 提交消息 │  张三                 │ 刚刚   │ a1b2c3d │
│ │    ● feat: add xxx │  李四                 │ 2m ago │ d3e4f5a │
│ ●── ┘  merge: …      │  张三                 │ 5m ago │ b7c8d9e │
│ ●      chore: init   │  张三                 │ 1h ago │ f1a2b3c │
└──────────────────────┴───────────────────────┴────────┴─────────┘
│  ┌─ Commit Detail Panel（点击某行展开）──────────────────────┐  │
│  │  Hash: a1b2c3d4e5f6...   Parents: d3e4f5a                │  │
│  │  Author: 张三 <z@example.com>   Date: 2026-05-25 14:30   │  │
│  │  Message: feat: add new feature                           │  │
│  │  Changed files: 3 files  [+24 / -8]                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3.2 布局结构

```
GitGraphPanel
├── Toolbar（过滤下拉 + 搜索 + 刷新按钮）
├── ResizablePanelGroup（上下两块，可拖拽分割线）
│   ├── GraphTablePanel（上：分支图 + 列表）
│   │   ├── TableHeader（图形区 | Message | Author | Date | Hash）
│   │   └── GraphRows（SVG 层 + 文本行叠加）
│   └── CommitDetailPanel（下：选中 commit 的详情，未选中时折叠为 0）
└── （右键菜单浮层 GitContextMenu）
```

### 6.3.3 GraphTablePanel 实现要点

**SVG + DOM 混合渲染**：

- SVG 绘制分支连线和 commit 圆点，`pointer-events: none`（只负责图形）
- 在 SVG 上方叠加等行高的 `<div>` 列表，每行包含 Message / Author / Date / Hash 文本
- 行高固定 `ROW_H = 28px`，与 SVG 圆点 `cy` 坐标保持一致

**列宽定义**：

| 列 | 宽度 | 说明 |
|----|------|------|
| 图形区 | `LANE_W × (maxLane+1) + 16px` | 随分支数自适应，最小 80px |
| Message | flex-1 | 分支 Badge + commit message |
| Author | 120px | 作者名 |
| Date | 80px | 相对时间（dayjs relativeTime） |
| Hash | 72px | 7 位短 hash，monospace |

**分支 Badge**（对应 commit 的 `refs`）：

```tsx
// 颜色 pill，LEFT 对齐放在 message 文字前
<span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: laneColor, color: '#000' }}>
  {refName}
</span>
```

- `HEAD` 单独渲染为空心圆（与圆点颜色一致）
- 分支名长度截断到 20 字符

**行选中与 Hover**：

- hover 行：`bg-muted/50`
- 选中行：`bg-accent/20 border-l-2 border-primary`（左侧高亮条）
- 点击行 → 更新 `selectedHash` state → 触发 CommitDetailPanel 展开

### 6.3.4 CommitDetailPanel

折叠/展开由 `selectedHash` 驱动（无额外按钮）：

```tsx
<div className={cn(
  'border-t border-border overflow-hidden transition-all duration-150',
  selectedHash ? 'h-[120px]' : 'h-0',
)}>
  {/* hash / author / date / parents / changed files 摘要 */}
</div>
```

内容：完整 hash（可复制）、作者邮件、精确时间、parent hashes、该 commit 变更文件数摘要（需额外 `GET /sessions/:id/git-log/:hash/files` 端点，P2 可选）。

### 6.3.5 右键上下文菜单 GitContextMenu

右键点击任意 commit 行弹出（使用 shadcn/ui `DropdownMenu` + absolute 定位）：

| 菜单项 | 行为 |
|--------|------|
| 切换到此分支 | `POST /sessions/:id/git/checkout`，仅 ref 含分支名时显示 |
| 从此提交新建分支 | 弹出分支名输入 Dialog，`POST checkout {createNew: true}` |
| 复制完整 Hash | `navigator.clipboard.writeText(hash)` |
| 查看此 Commit Diff | 切换到 Diff 面板并传入 commitHash（P2） |

### 6.3.6 相对时间格式

使用 `dayjs` + `relativeTime` 插件（项目已有 `dayjs` 依赖则复用，否则用原生逻辑）：

```typescript
function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
```

### 6.3.7 实现文件

```
apps/web/src/components/git/
  GitGraphPanel.tsx       ← 主面板（重写，含 Toolbar + ResizablePanelGroup）
  GitContextMenu.tsx      ← 右键菜单（新建）
apps/web/src/lib/
  git-graph-utils.ts      ← buildGraph lane 算法 + relativeTime（从 GitGraphPanel 拆出）
```

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
  GitContextMenu.tsx      ← 已并入 6.3.5 方案
apps/web/src/components/session/SessionInfoPanel.tsx  # Git 操作区按钮（原 SessionSidebar）
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
Step 1  共享类型扩展（packages/shared-types）                        ~0.5h
Step 2  后端 WorktreeManager.getGitLog()                             ~1h
Step 3  后端新增 REST 端点 + WebSocket 推送                           ~1h
Step 4  布局重构：ActivityBar + SessionDetail 重写（图标侧边栏）        ~2h
Step 5  SessionSidebar → SessionInfoPanel 重命名 + 样式适配            ~0.5h
Step 6  GitGraphPanel 升级：工具栏 + 表格布局 + SVG 分支图             ~3h
Step 7  CommitDetailPanel + GitContextMenu（右键菜单）                ~1.5h
Step 8  Git 操作弹窗（GitCommitDialog / GitMergeDialog）联调           ~2h
Step 9  暗色主题 + ResizableHandle + FitAddon 适配                    ~1h
```

---

## 验收清单

### L1 布局重构（图标侧边栏）

| # | 步骤 | 预期结果 |
|---|------|---------|
| L1-1 | 打开任意会话详情 | 左侧 48px 图标栏可见，默认激活 Terminal 图标，右侧主区占满全宽 |
| L1-2 | Terminal 激活时 | 终端高度占满主区全部，不再挤在底部 40% |
| L1-3 | 点击 Git Graph 图标 | 切换到 Git Graph 面板，Terminal xterm 实例不销毁 |
| L1-4 | 点击 Diff 图标 | 切换到 DiffViewer，有 diff 时右上角角标正确显示数量 |
| L1-5 | 点击 任务信息 图标 | 切换到 SessionInfoPanel，显示任务描述 / 状态 / Git 操作按钮 |
| L1-6 | 各图标 hover | Tooltip 正确显示图标名称（无文字标签时） |

### L2 Git Graph 可视化（IDEA 风格）

| # | 步骤 | 预期结果 |
|---|------|---------|
| G1 | 进入 Git Graph 面板 | 显示列头（Message / Author / Date / Hash），每行一个 commit，SVG 分支图在 Message 列左侧 |
| G2 | 存在多分支历史 | 不同 lane 颜色区分，merge commit 弧线正确连接 |
| G3 | 点击某 commit 行 | 该行高亮（左侧蓝色边条），底部 CommitDetailPanel 展开显示完整 hash / 作者 / 时间 |
| G4 | 当前 HEAD commit | 分支 badge 显示 `HEAD` 且 commit 圆点为空心白圈 |
| G5 | 右键某 commit 行 | 弹出上下文菜单（切换分支 / 新建分支 / 复制 hash） |
| G6 | 在 worktree 中做新 commit | 1~2s 内 Git Graph 自动刷新（WebSocket `git:log-updated` 驱动） |
| G7 | 使用分支过滤下拉 | 仅显示所选分支的 commit 历史 |

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
| SVG + DOM 叠加层行高不同步 | G1 圆点位置偏移 | `ROW_H` 常量在 SVG 和 DOM 层共享同一值，禁止各自硬编码 |
| lane 分配算法对复杂 rebase 历史 | G2 分支线混乱 | 第一版 `--max-count=100`，超出截断；复杂场景 fallback 线性列表 |
| 图标侧边栏图标含义不直观 | L1-6 用户误操作 | 所有图标必须有 hover Tooltip；首次进入默认激活 Terminal | 
| `react-resizable-panels` 与 xterm.js FitAddon 冲突 | L1-2 终端尺寸错误 | resize 完成后手动触发 `fitAddon.fit()` + debounce 100ms |
| Merge 操作在 Windows worktree 路径含空格时 simple-git 报错 | O3 失败 | worktree 路径已使用 session ID（纯字母数字），通常无空格 |
