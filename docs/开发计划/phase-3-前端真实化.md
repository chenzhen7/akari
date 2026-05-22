# 阶段三：前端真实化

**状态**：🔲 待开始 | **预计工时**：2~3 天 | **前置**：阶段二

---

## 3.1 真实终端（xterm.js）

- [ ] 安装：`pnpm add xterm xterm-addon-fit xterm-addon-web-links`（`apps/web`）
- [ ] 重写 `TerminalPanel.tsx`：接收 `terminal:data` WebSocket 事件，替换 Mock 输出
- [ ] 支持用户向终端输入（发送 `terminal:input`）
- [ ] 终端尺寸自适应（`FitAddon`）
- [ ] 保留滚动历史 buffer

> **注意**：`useRef` 保护初始化，`useEffect` 返回 `dispose()`，防止 React 18 Strict Mode 双重挂载泄露。

## 3.2 真实 Diff 视图

- [ ] 安装：`pnpm add @monaco-editor/react`（`apps/web`），动态 `import()` 懒加载
- [ ] 新建 `apps/web/src/components/diff/DiffViewer.tsx`：Monaco Diff Editor，接收 `diff:update` 事件
- [ ] TaskPanel 内嵌实时 Diff 摘要（文件列表 + 行数统计）
- [ ] 审批弹窗内嵌完整 Diff（Monaco Viewer）

## 3.3 会话创建真实流程

- [ ] CreateSessionDialog 提交后调用 `POST /sessions`
- [ ] 前端监听 `session:created` 事件，自动打开新 Tab
- [ ] Worktree 创建进度反馈（`initializing` 状态时显示 spinner）

## 3.4 画布 / 看板联动优化

- [ ] Canvas 节点位置变更同步到后端（持久化坐标）
- [ ] 看板拖拽触发真实状态流转（调用 `PATCH /sessions/:id/status`）
- [ ] 会话状态变更时画布节点颜色实时更新（WebSocket 驱动）
