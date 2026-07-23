# CLAUDE.md

---

## 项目概述

**Akari** 是一个 AI Agent 并行开发管理平台。完整产品架构见 [docs/设计文档.md](docs/设计文档.md)，开发计划见 [docs/开发计划.md](docs/开发计划.md)。

---

## 技术栈

```
前端 (apps/web): React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
画布: @xyflow/react
看板: @dnd-kit/core
终端: @xterm/xterm + FitAddon + WebLinksAddon
状态: Zustand
Diff: @monaco-editor/react（懒加载）

后端 (apps/server): Node.js + Fastify 5 + @fastify/websocket
终端复用: node-pty（PTY，Shell: PowerShell 7 / pwsh.exe）
Git 操作: simple-git
文件监听: chokidar
通信: WebSocket（ws://localhost:3001/ws）
数据库: SQLite - better-sqlite3

共享类型: packages/shared-types（workspace:*）
```

---

## 项目结构（当前实际）

```
akari/
├── apps/
│   ├── server/                        # 后端 Fastify 服务
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # 入口：依赖组装、插件注册、服务启动
│   │       ├── session-manager.ts     # SessionManager Facade（组合 Service / 事件连线）
│   │       ├── core/                  # 领域核心（状态机、工厂）
│   │       │   ├── session-state-machine.ts   # 会话状态机 + validateTransition
│   │       │   └── session-factory.ts         # AgentSession / MainSession 工厂
│   │       ├── services/              # 业务编排层（可单测、依赖接口）
│   │       │   ├── session-lifecycle.service.ts
│   │       │   ├── tab.service.ts
│   │       │   ├── terminal.service.ts
│   │       │   ├── worktree.service.ts
│   │       │   ├── git-query.service.ts
│   │       │   ├── workspace.service.ts
│   │       │   ├── workspace-session-registry.service.ts
│   │       │   └── hook-dispatcher.service.ts
│   │       ├── infrastructure/        # 基础设施（实现细节）
│   │       │   ├── db/
│   │       │   │   ├── canvas-edge-store.ts
│   │       │   │   ├── settings-store.ts
│   │       │   │   └── repositories/
│   │       │   │       ├── session.repository.ts
│   │       │   │       ├── workspace.repository.ts
│   │       │   │       ├── settings.repository.ts
│   │       │   │       └── canvas-edge.repository.ts
│   │       │   ├── git/
│   │       │   │   ├── git-command-runner.ts
│   │       │   │   ├── git-repository.ts
│   │       │   │   ├── git-repository-registry.ts
│   │       │   │   ├── git-repository-detector.ts
│   │       │   │   └── git-utils.ts
│   │       │   ├── pty/
│   │       │   │   └── terminal-multiplexer.ts
│   │       │   └── fs/
│   │       │       └── file-system.service.ts
│   │       ├── types/
│   │       │   └── fastify.d.ts       # Fastify 装饰器类型声明
│   │       ├── plugins/
│   │       │   ├── websocket.ts       # WebSocket 注册与客户端消息处理
│   │       │   └── static.ts          # SPA static fallback
│   │       ├── routes/                # HTTP/WebSocket 入口（通过 SessionManager Facade 调用）
│   │       │   ├── health.ts
│   │       │   ├── settings.ts
│   │       │   ├── repo.ts
│   │       │   ├── sessions.ts
│   │       │   ├── git.ts
│   │       │   ├── files.ts
│   │       │   ├── diff.ts
│   │       │   ├── terminal.ts
│   │       │   ├── tabs.ts
│   │       │   ├── workspace.ts
│   │       │   ├── canvas.ts
│   │       │   └── hooks.ts
│   │       └── agent-adapters/        # AgentAdapter 接口 + 各品牌实现
│   │           ├── base.ts
│   │           ├── claude.ts
│   │           ├── claude-orchestrator.ts
│   │           ├── kimi.ts
│   │           ├── aider.ts
│   │           ├── shell.ts
│   │           └── index.ts
│   ├── desktop/                       # Electron 桌面端
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── electron-builder.yml       # NSIS / portable 打包配置
│   │   ├── src/
│   │   │   ├── main.ts                # Electron 主进程
│   │   │   └── preload.ts             # 预加载脚本
│   │   └── dist/                      # tsc 输出
│   └── web/                           # 前端（Feature/Module 架构）
│       ├── package.json
│       ├── vite.config.ts             # 含 /api 和 /ws 反向代理 + alias
│       ├── tsconfig.json / app / node
│       ├── index.html
│       └── src/
│           ├── app/
│           │   ├── App.tsx            # 应用根组件
│           │   └── main.tsx           # 渲染入口
│           ├── features/              # 按功能模块组织
│           │   ├── session/           # 会话相关组件、store、lib
│           │   ├── terminal/          # 终端连接 store、terminalBus
│           │   ├── git/               # Git 图组件 + git-graph-utils
│           │   ├── diff/              # Diff 查看器
│           │   ├── explorer/          # 文件树 + 编辑器 + file-tree-store
│           │   ├── kanban/            # 看板视图
│           │   ├── canvas/            # 画布视图
│           │   ├── workspace/         # 工作区选择器 + store
│           │   ├── command-center/    # 广播命令中心
│           │   ├── settings/          # 设置对话框
│           │   └── layout/            # AppShell、TopNav、Sidebar 等布局组件
│           └── shared/                # 跨 feature 的通用能力
│               ├── components/
│               │   ├── ui/            # shadcn/ui 组件
│               │   ├── icons/         # ClaudeIcon、KimiIcon
│               │   └── theme-provider.tsx
│               ├── lib/               # 通用工具（api、utils、toast、agent-config 等）
│               ├── hooks/             # 通用 hooks
│               ├── stores/            # 跨 feature 的 store（ui-store、window-store 等）
│               └── types/             # 通用类型
├── packages/
│   └── shared-types/                  # 前后端共享类型包
│       ├── package.json
│       └── src/
│           └── index.ts               # AgentSession / ServerMessage / ClientMessage / HookEvent 等
├── docs/
│   ├── 设计文档.md
│   ├── 开发计划.md
│   └── 开发计划/                      # phase-N-*.md 各阶段详细任务
├── pnpm-workspace.yaml
├── package.json                       # workspace root，含 dev:all / typecheck 脚本
├── AGENTS.md / CLAUDE.md              # AI Agent 上下文（内容相同）
└── .claude/rules/error-handling.md    # 异常处理规范
```

---

## 启动方式

```bash
# 安装依赖（首次或新增包后）
pnpm install

# 开发模式：同时启动前端 + 后端
pnpm dev:all

# 桌面端开发模式（启动前后端 + Electron）
pnpm dev:desktop

# 单独启动
pnpm dev:server                  # 后端 http://localhost:3001
pnpm dev                       # 前端 http://localhost:5173

# 类型检查
pnpm typecheck                 # 全 workspace 类型检查
# 或单独
pnpm --filter @akari/web    typecheck
pnpm --filter @akari/server typecheck
pnpm --filter @akari/desktop typecheck

# 桌面端生产打包（输出 NSIS 安装包 + portable）
pnpm build:desktop
```

---


## 编码规范

### TypeScript
- 严格模式（`strict: true`）
- 所有公共 API 必须显式标注返回类型
- 优先使用 `interface` 定义对象类型
- 禁止 `as` 断言，使用类型守卫

### React
- 函数组件 + Hooks
- Props 解构，命名：`ComponentNameProps`
- 状态管理用 Zustand，避免深层 prop drilling
- 副作用集中放在自定义 Hooks

### 命名约定
- 文件：PascalCase（组件），camelCase（工具），kebab-case（配置）
- 变量：camelCase；常量：UPPER_SNAKE_CASE；类型：PascalCase
- CSS：Tailwind 优先，复杂样式用 `cn()` 工具函数

### UI 交互规范
**确认弹窗**
- 所有需要二次确认的破坏性操作，统一使用 shadcn/ui `<Dialog>` 组件，**禁止使用内联 `confirmXxx` 状态**

**错误处理原则**
- 不做静默兜底（如 catch 后 fallback 到本地数据）；异常必须上报，让错误可见
- 兜底逻辑会掩盖真实问题，禁止以「降级」为由隐藏错误

**定位 Bug 的纪律**
- 找到根本原因前，不提交补丁；找到后，**回滚所有错误方向的补丁**，再应用最小化正确修复
---

## Agent 集成协议

实现 Agent 适配器时必须满足 `AgentAdapter` 接口：

```typescript
export interface PtyCommand {
  cmd: string       // 发送到 PTY 的原始字符串（含换行符）
  delayMs?: number  // 发送前等待的毫秒数（相对于前一条命令）
}

export interface AgentLaunchOptions {
  bypassPermissions?: boolean
}

export interface AgentAdapter {
  readonly agentType: string
  readonly displayName: string
  readonly requiresTty: boolean
  readonly stdinSubmitSequence: string
  readonly readyIndicatorPattern?: RegExp
  readonly supportsBypassPermissions: boolean
  readonly isAutomated: boolean

  getTabLabel(): string
  buildArgs?(opts: { task: string; worktreePath: string; bypassPermissions?: boolean }): string[]
  formatPrompt?(task: string): string
  prepare(worktreePath: string, task: string, sessionId: string, options?: AgentLaunchOptions): Promise<PtyCommand[]>
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `agentType` | 适配器唯一标识，对应 `AgentType` |
| `displayName` | 前端展示名称 |
| `requiresTty` | 是否需要 PTY |
| `stdinSubmitSequence` | 向该 Agent 提交输入的换行/确认序列 |
| `readyIndicatorPattern` | 可选：识别 Agent 就绪提示符的正则 |
| `supportsBypassPermissions` | 是否支持权限绕过参数 |
| `isAutomated` | 是否为自动化 Agent（决定默认创建 `agent` 类型标签还是 `terminal`） |
| `getTabLabel()` | 该 Agent 的默认标签名 |
| `buildArgs()` | 构造启动参数 |
| `formatPrompt()` | 可选：格式化任务提示 |
| `prepare()` | 在 worktree 创建后调用，返回要发送到 PTY 的命令序列 |

**当前实现**：

| 文件 | 说明 |
|------|------|
| `claude.ts` | Claude Code，注入 `.claude/settings.local.json` HTTP Hook |
| `claude-orchestrator.ts` | Claude Orchestrator 变体，继承 ClaudeAdapter |
| `kimi.ts` | Kimi CLI 适配 |
| `aider.ts` | Aider 适配 |
| `shell.ts` | 纯 Shell，未知 `agentType` 的回退适配器 |

**ClaudeAdapter Hook 行为**：

| Hook 事件 | 行为 |
| :--- | :--- |
| `PermissionRequest` | 记录审批日志（当前**不阻塞** Claude Code 原生权限流程） |
| `SessionStart` | `initializing` → `idle` |
| `UserPromptSubmit` | `paused` / `waiting` / `idle` → `running` |
| `Stop` | `running` / `waiting` → `idle`，并广播 `session:lastMessage` |
| `StopFailure` | `running` / `paused` / `waiting` → `failed` |

> **历史说明**：早期版本通过终端输出解析 `[CHECKPOINT]` / `[APPROVAL_REQUIRED]` 魔法字符串驱动状态机，该机制已完全废弃，改为 HTTP Hook 单轨驱动。

---

## Agent 抽象与 Tab 类型规范

- `AgentType`（`claude` / `claude-orchestrator` / `aider` / `shell` / `kimi` 等）描述“使用哪种 Agent 适配器”，属于会话/标签的元数据。
- 标签页类型 `SessionTab.type` 只描述标签的**形态**，必须是通用的 `'terminal' | 'agent' | 'diff' | 'file'`：
  - `'agent'` 代表“运行 Agent 的终端标签”，不区分具体 Agent 品牌。
  - 具体品牌通过 `tab.agentType` 区分，用于图标、标签文字和 adapter 路由。
- **禁止**把某个 Agent 品牌（如 `'claude'`）直接作为 `SessionTab.type` 写入。新增 Agent 时，只扩展 `AgentType` 和 `agent-adapters`，不要新增 tab 类型。
- 前端所有 Agent 品牌相关的图标、颜色、显示名统一从 `apps/web/src/lib/agent-config.ts` 的 `AGENT_CONFIG` 读取，禁止在组件内硬编码。

```typescript
export const AGENT_CONFIG: Record<AgentType, AgentConfig> = {
  claude: { displayName: 'Claude Code', icon: ClaudeIcon, color: '#7c3aed', supportsBypassPermissions: true },
  'claude-orchestrator': { displayName: 'Claude Orchestrator', icon: Bot, color: '#b45309', supportsBypassPermissions: true },
  aider: { displayName: 'Aider', icon: Code2, color: '#2563eb', supportsBypassPermissions: false },
  kimi: { displayName: 'Kimi', icon: KimiIcon, color: '#1783FF', supportsBypassPermissions: true },
  shell: { displayName: 'Shell', icon: Terminal, color: '#374151', supportsBypassPermissions: false },
}
```

- 当已持久化的旧数据中出现被废弃的类型/字段时，应在 `SessionManager.initDb()` 里做一次性迁移，将数据改写为新形态，随后删除运行时兼容代码。不得以“兼容旧数据”为由在业务逻辑中保留分支。

---

## Worktree 管理规范

- Worktree 基础目录：`<worktreeBaseDir>/<repoSlug>/<sessionId>/`（默认 `<repo>/.agent-worktrees/<repoSlug>/<sessionId>/`）
- 分支命名：`agent/<sessionId前8位>`
- 依赖隔离：通过符号链接复用 `node_modules`
- 清理：会话结束后必须调用 `removeWorktree()`

---

## 核心实现原则（禁止违反）

1. **物理隔离优先**：每个 Agent 会话使用独立 worktree，禁止直接在主工作区操作
2. **状态驱动 UI**：所有视图（画布/看板/Tab）共享同一份会话状态，WebSocket 事件驱动更新
3. **终端即真相**：Agent 输出通过终端复用器捕获，不通过自定义协议通信
4. **审批不可绕过**：危险操作必须经用户审批，Agent 适配器不得自动确认
5. **禁止遗留历史债务**：完成任务后必须同步清理废弃文件、死代码、过时注释和临时脚手架。迁移后旧路径立即删除，重构后旧实现立即移除，不得以「后续清理」为由搁置。AGENTS.md / progress.md 中的「待清理」标记视为未完成任务。
6. **数据迁移一次性完成**：当已持久化的旧数据中出现被废弃的类型/字段时，应在 `SessionManager.initDb()` 里做一次性迁移，将数据改写为新形态，随后删除运行时兼容代码。不得以“兼容旧数据”为由在业务逻辑中保留分支。
7. **重大决策必须先征询用户**：凡涉及以下任一情形，**禁止**自行做出决定并直接实施，必须先向用户说明方案对比、征得明确同意后再动手：
   - 技术方案降级或替代（如用 `child_process` 替代 `node-pty`、用 mock 替代真实实现）
   - 架构层面的设计取舍（如数据库选型、通信协议变更、模块拆分方式）
   - 破坏性 API/类型变更（影响已有接口的签名或行为）
   - 任何「此方案有明显缺点但省事」的捷径
   正确做法：先用 `ask_user_question` 工具列出选项和利弊，等待用户选择后再执行。不得在文档中写「降级方案」后自动采用该方案。
8. **禁止吞异常**：空 `catch {}` / 只写注释的 catch 一律禁止；前端用户操作失败必须 `toast.error()`；后端必须 `log.warn/error()`；状态机非法转换用 `validateTransition()` 守卫而非 try/catch。详见 [.claude/rules/error-handling.md](.claude/rules/error-handling.md)。
---

## 已知问题 / 技术风险

| 问题 | 影响 | 处理建议 |
|------|------|----------|
| `node-pty` Windows 需 VC++ Build Tools | F3 开发环境 | 已解决：VC++ Build Tools 已安装，node-pty 编译成功；Shell 已切换为 PowerShell 7.6.2 |
| ~~xterm.js + React 18 Strict Mode 双重挂载~~ | ~~F3 内存泄露~~ | 已解决：`TerminalPanel` 改用模块级 `terminalInstances` Map 保活 xterm 实例，切 Tab 不再 dispose/重建，terminalBus 订阅全程存活 |
| Monaco Editor 包体积 ~2MB | F4 首屏性能 | 动态 `import()` 懒加载，Diff 面板 / 文件编辑器打开时才加载 |
| ~~`.agent-worktrees/` 未加入 `.gitignore`~~ | ~~F2 误提交~~ | 已解决：已在 `.gitignore` 中添加 |
| 审批工作流未实现同步阻塞 | F8 安全性 | `PermissionRequest` Hook 当前仅记录日志，不挂起 HTTP 请求；Claude Code 仍使用原生权限确认。后续如需统一审批中心，需实现阻塞式审批 |
| 画布功能默认关闭 | F1 功能可用性 | `CANVAS_ENABLED = false`，当前主入口为看板 + Tab 视图 |
| `pnpm typecheck` 未真正检查 app 源文件 | 开发体验 | 项目使用 project references，`tsc --noEmit` 不编译 references；应使用 `tsc --build` 或 `-p tsconfig.app.json` |
| `pnpm lint` 存在既有 ESLint 错误 | 代码质量 | `apps/web` 有 36 个既有错误（ref render 更新、useCallback 闭包等），需另开一轮修复 |

---

## 文档索引

- [docs/设计文档.md](docs/设计文档.md) — 完整产品架构、数据模型、视图设计、代码示例
- [.claude/rules/error-handling.md](.claude/rules/error-handling.md) — **异常处理规范**：禁止吞异常、前端用 toast 暴露错误、状态机用守卫代替 try/catch
- [docs/claude code 的hook参考.md](docs/claude%20code%20%E7%9A%84hook%E5%8F%82%E8%80%83.md) — Claude Code 的 hook 参考
- [docs/状态变化机制.md](docs/状态变化机制.md) — 基于 HTTP Hook 的状态流转机制
- [docs/开发计划/phase-8-基于Hooks的Agent状态流程机制改造计划.md](docs/开发计划/phase-8-基于Hooks的Agent状态流程机制改造计划.md) — Phase 8 HTTP Hook 改造详情
