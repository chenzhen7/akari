# 阶段六：收尾与打磨

**状态**：🚧 部分实现 | **前置**：阶段一~五

> **说明**：以下子项已实现：
> - Worktree 创建失败自动回滚清理（`initSession` 异常处理）
> - PTY 进程崩溃/退出检测，更新 session 状态为 `completed` / `failed`
> - 会话归档 / 恢复
>
> 以下子项尚未实现：
> - 全局 React Error Boundary
> - 快捷键：`Ctrl+K` 打开 CommandCenter，`Ctrl+T` 新建会话
> - 会话标签颜色自定义
> - 全局搜索（按任务名/分支名/标签过滤）
> - 导出会话报告（Markdown / JSON）

---

## 6.1 错误处理 & 健壮性

- [ ] Worktree 创建失败自动回滚清理
- [ ] PTY 进程崩溃检测，更新 session 状态为 `failed`
- [ ] 全局错误边界（React Error Boundary）


## 6.3 用户体验

- [ ] 快捷键：`Ctrl+K` 打开 CommandCenter，`Ctrl+T` 新建会话
- [ ] 会话标签颜色自定义
- [ ] 全局搜索（按任务名/分支名/标签过滤）
- [ ] 导出会话报告（Markdown / JSON）


