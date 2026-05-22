# 阶段六：收尾与打磨

**状态**：🔲 待开始 | **前置**：阶段一~五

---

## 6.1 错误处理 & 健壮性

- [ ] Worktree 创建失败自动回滚清理
- [ ] WebSocket 断线自动重连 + 事件队列补偿
- [ ] PTY 进程崩溃检测，更新 session 状态为 `failed`
- [ ] 全局错误边界（React Error Boundary）

## 6.2 性能优化

- [ ] 画布节点虚拟化（会话数 > 20 时）
- [ ] 终端 ring buffer 限制，防止内存泄露
- [ ] Diff 增量推送（仅推变更文件，非全量）

## 6.3 用户体验

- [ ] 快捷键：`Ctrl+K` 打开 CommandCenter，`Ctrl+T` 新建会话
- [ ] 会话标签颜色自定义
- [ ] 全局搜索（按任务名/分支名/标签过滤）
- [ ] 导出会话报告（Markdown / JSON）

## 6.4 测试

- [ ] 后端单元测试：WorktreeManager、TerminalMultiplexer、SessionManager（Vitest）
- [ ] 前端组件测试：审批弹窗交互（React Testing Library）
- [ ] E2E 基础冒烟测试（Playwright）
