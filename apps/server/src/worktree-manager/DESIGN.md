# WorktreeManager 模块设计

> 对应功能模块 **F2（Worktree 管理）**，前置依赖 F1（SessionManager）。  
> 文件位置：`apps/server/src/worktree-manager.ts`

## 职责

- 为每个 Agent 会话创建独立 Git Worktree（物理隔离）
- 获取 / 监听文件变更 Diff，实时推送给前端
- 执行合并（squash / merge / rebase）策略
- 会话结束后清理 Worktree

## 路径规范

| 项 | 规则 |
|----|------|
| Worktree 根目录 | `<repo>/.agent-worktrees/<sessionId>/` |
| 分支命名 | `agent/<taskName>-<sessionId前8位>` |
| node_modules | 软链复用主仓库，禁止重复安装 |

> ⚠️ `.agent-worktrees/` 必须加入 `.gitignore`。

## 实现代码

```typescript
// apps/server/src/worktree-manager.ts
import { execa } from 'execa';
import * as path from 'path';
import * as fs from 'fs-extra';
import chokidar from 'chokidar';

export class WorktreeManager {
  private baseRepoPath: string;
  private worktreeBaseDir: string;

  constructor(repoPath: string) {
    this.baseRepoPath = repoPath;
    this.worktreeBaseDir = path.join(repoPath, '.agent-worktrees');
  }

  async createWorktree(sessionId: string, taskName: string, baseBranch = 'main') {
    const branchName = `agent/${taskName}-${sessionId.slice(0, 8)}`;
    const worktreePath = path.join(this.worktreeBaseDir, sessionId);

    await execa('git', ['worktree', 'add', '-b', branchName, worktreePath, baseBranch], {
      cwd: this.baseRepoPath
    });

    await this.setupWorktreeEnv(worktreePath);
    return { branchName, worktreePath };
  }

  async getDiff(sessionId: string): Promise<GitDiff> {
    const cwd = this.getWorktreePath(sessionId);
    const [{ stdout: stat }, { stdout: full }, { stdout: files }] = await Promise.all([
      execa('git', ['diff', '--stat', 'HEAD'], { cwd }),
      execa('git', ['diff', 'HEAD'],           { cwd }),
      execa('git', ['diff', '--name-status', 'HEAD'], { cwd }),
    ]);
    return { stat, fullDiff: full, files: this.parseFileStatus(files), summary: this.parseStat(stat) };
  }

  async watchDiff(sessionId: string, callback: (diff: GitDiff) => void) {
    const watcher = chokidar.watch(this.getWorktreePath(sessionId), {
      ignored: /node_modules|\.git/,
      persistent: true,
      debounce: 500,
    });
    watcher.on('change', async () => callback(await this.getDiff(sessionId)));
    return watcher;
  }

  async mergeToBase(sessionId: string, strategy: 'squash' | 'merge' | 'rebase' = 'squash') {
    const { branchName } = await this.getSessionInfo(sessionId);
    if (strategy === 'squash') {
      await execa('git', ['merge', '--squash', branchName], { cwd: this.baseRepoPath });
    }
    // rebase / merge 策略待补充
  }

  async removeWorktree(sessionId: string) {
    await execa('git', ['worktree', 'remove', '--force', this.getWorktreePath(sessionId)], {
      cwd: this.baseRepoPath
    });
  }

  private getWorktreePath(sessionId: string) {
    return path.join(this.worktreeBaseDir, sessionId);
  }

  private async setupWorktreeEnv(worktreePath: string) {
    const srcModules = path.join(this.baseRepoPath, 'node_modules');
    const dstModules = path.join(worktreePath, 'node_modules');
    if (await fs.pathExists(srcModules)) {
      await fs.symlink(srcModules, dstModules);
    }
  }
}
```

## 对外事件（由 SessionManager 监听）

| 事件 | 触发时机 | 推送给前端的 WS 事件 |
|------|----------|---------------------|
| diff 变更 | `chokidar` 文件变更防抖 500ms | `diff:update { sessionId, diff }` |

## 依赖安装

```bash
pnpm add execa fs-extra chokidar
```
