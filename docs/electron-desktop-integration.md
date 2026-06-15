# Electron 桌面端集成方案

## 1. 概述

Akari 桌面端基于 Electron，主进程负责：

- 生产模式：启动后端子进程并加载前端页面
- 开发模式：连接 Vite dev server
- 退出时优雅关闭后端

前后端通信采用 WebSocket + REST，与 Web 版本共享同一套前端代码。

## 2. 整体架构

```
┌─────────────────────────────────────────┐
│           Electron 主进程               │
│     (apps/desktop/src/main.ts)          │
│                                         │
│  生产模式：启动后端子进程 → 解析随机端口  │
│          → 加载 http://127.0.0.1:<port> │
│  开发模式：加载 Vite dev server         │
│          → http://127.0.0.1:57123       │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Fastify 后端              React 前端
apps/server              apps/web
```

## 3. 生产模式

### 3.1 后端作为子进程启动

`apps/desktop/src/main.ts` 中的 `startServer()`：

```ts
const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: '0',
  HOST: '127.0.0.1',
  REPO_ROOT: userData,
  DATA_DIR: path.join(userData, 'data'),
  WEB_DIST_PATH: webDistPath,
}
```

- `PORT=0`：让后端绑定随机端口，避免冲突
- `HOST=127.0.0.1`：仅监听本地回环
- `REPO_ROOT` / `DATA_DIR`：指向 Electron `userData`
- `WEB_DIST_PATH`：指向前端 `dist` 目录

后端启动后会在 stdout 输出 `AKARI_PORT=<port>`，主进程解析后创建窗口：

```ts
createWindow(`http://127.0.0.1:${port}`)
```

### 3.2 后端直接 serve 前端 dist

`apps/server/src/index.ts`：

```ts
const webDistPath = process.env.WEB_DIST_PATH
if (webDistPath) {
  await fastify.register(fastifyStatic, {
    root: resolve(webDistPath),
    wildcard: false,
  })
}
```

生产包不需要独立 HTTP 服务器，Fastify 直接托管静态资源。

### 3.3 前端地址自适应

`apps/web/src/lib/api.ts`：

```ts
export const API_BASE = import.meta.env.VITE_API_URL || ''
```

- 生产构建：不设置 `VITE_API_URL`，使用相对路径
- 开发环境：通过 `VITE_API_URL` 指定后端地址

`apps/web/src/hooks/useWebSocket.ts`：

```ts
function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws`
  }
  return 'ws://127.0.0.1:39321/ws'
}
```

- 生产：WebSocket 随页面 origin 自动指向 Electron 启动的后端
- 开发：走 Vite proxy 到后端

## 4. 开发模式

### 4.1 Node 编排脚本

`apps/desktop/scripts/dev.mjs` 统一启动三个进程：

1. 后端（`HOST=127.0.0.1`）
2. 前端 Vite（`VITE_API_URL=http://127.0.0.1:39321`，端口 `57123`）
3. Electron

通过 `fetch()` 轮询 `/health` 和前端根路径，确认就绪后再启动 Electron，退出时自动清理子进程。

采用 Node 脚本而不是 `concurrently + wait-on`，是因为 Windows 下 shell 引号、`&&`、`tcp` 等待逻辑不稳定。

### 4.2 固定不常见端口

- 后端：`39321`
- 前端 Vite：`57123`

避免与常见端口（3001/5173）冲突。

### 4.3 统一使用 127.0.0.1

目标 Windows 机器上 `localhost` 可能被解析到 IPv6 `::1`，而服务绑在 IPv4 `127.0.0.1`，导致 `localhost:port` 全部连不上。因此开发环境统一使用 `127.0.0.1`：

- 后端 `HOST=127.0.0.1`
- Vite `host: "127.0.0.1"`
- Electron 加载 `http://127.0.0.1:57123`
- `VITE_API_URL=http://127.0.0.1:39321`
- Vite proxy target 指向 `127.0.0.1:39321`
- WebSocket fallback 指向 `127.0.0.1:39321`

### 4.4 Electron dev 模式识别

`apps/desktop/package.json`：

```json
"dev": "cross-env NODE_ENV=development tsc && electron ."
```

`apps/desktop/src/main.ts` 中的 `isDev` 判断依赖 `NODE_ENV=development`。未注入时 Electron 会误判为生产模式，进入 `startServer()` 分支，去找不存在的 `apps/server/dist/index.js`，窗口还没创建就失败。

## 5. 原生模块处理

项目使用 `better-sqlite3` 和 `node-pty` 两个原生模块。

### 5.1 pnpm 安装时允许原生编译

`pnpm-workspace.yaml`：

```yaml
allowBuilds:
  better-sqlite3: true
  electron: true
  electron-winstaller: true
  lzma-native: true
  node-pty: true
  sharp: true
```

`pnpm install` 时会执行这些包的 `install` 脚本，编译出适合当前系统 Node 的原生二进制。Windows 环境需要安装 VC++ Build Tools。

### 5.2 Electron 打包前重建原生模块

`apps/desktop/package.json`：

```json
"postinstall": "electron-builder install-app-deps"
```

Electron 内置 Node 版本与系统 Node 不同，`electron-builder install-app-deps` 会调用 `@electron/rebuild` 把 `better-sqlite3`、`node-pty` 等模块重编成 Electron 可用的二进制。

### 5.3 生产包携带 server node_modules

`apps/desktop/electron-builder.yml`：

```yaml
extraResources:
  - from: ../server/dist
    to: server/dist
  - from: ../server/node_modules
    to: server/node_modules
```

生产模式下 Electron 启动的是 `resources/server/dist/index.js`，它加载同目录下 `resources/server/node_modules` 里已经重编过的原生模块。

### 5.4 开发 vs 生产

| 场景                 | Node 环境                         | 原生模块来源                      |
| -------------------- | --------------------------------- | --------------------------------- |
| `pnpm dev:server`    | 系统 Node                         | `apps/server/node_modules`        |
| `pnpm dev:desktop`   | 系统 Node 跑后端，Electron 跑前端 | 后端用 `apps/server/node_modules` |
| `pnpm build:desktop` | Electron 内置 Node                | `resources/server/node_modules`   |

## 6. 关键文件

| 文件                                 | 作用                                                |
| ------------------------------------ | --------------------------------------------------- |
| `apps/desktop/src/main.ts`           | Electron 主进程；生产启动后端、加载窗口、退出清理   |
| `apps/desktop/src/preload.ts`        | 最小预加载脚本，开启 contextIsolation               |
| `apps/desktop/package.json`          | dev/build/dist 脚本                                 |
| `apps/desktop/electron-builder.yml`  | NSIS + portable 打包配置                            |
| `apps/desktop/scripts/dev.mjs`       | 开发模式三进程编排脚本                              |
| `apps/server/src/index.ts`           | Fastify 入口；支持 PORT=0、WEB_DIST_PATH、HOST 覆盖 |
| `apps/server/src/constants.ts`       | 集中 `DEFAULT_PORT = 39321`                         |
| `apps/web/vite.config.ts`            | Vite host/proxy 配置                                |
| `apps/web/src/lib/api.ts`            | `API_BASE` 自适应常量                               |
| `apps/web/src/hooks/useWebSocket.ts` | WebSocket URL 自适应                                |
| `package.json`                       | 根脚本                                              |

## 7. 常用命令

```bash
# 桌面开发
pnpm dev:desktop

# 单独前后端
pnpm dev:server
pnpm dev

# 类型检查
pnpm typecheck

# 构建前端
pnpm build

# 打包完整桌面安装包
pnpm build:desktop
```

## 8. 踩坑记录

| 问题                            | 根因                                                              | 修复                             |
| ------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| 生产环境 `/fs/list` 连不上      | 前端写死 `localhost:3001`，与 Electron 随机端口冲突               | `API_BASE` / WS URL 自适应       |
| `pnpm dev:desktop` 不弹窗       | 桌面 dev 脚本未注入 `NODE_ENV=development`，Electron 进入生产分支 | `cross-env NODE_ENV=development` |
| `localhost` 地址连不上          | Windows 将 `localhost` 解析到 IPv6 `::1`，服务绑在 IPv4           | 全部改用 `127.0.0.1`             |
| `concurrently + wait-on` 不稳定 | Windows shell 引号/`&&`/等待逻辑反复失效                          | 改为 Node 编排脚本 `dev.mjs`     |
