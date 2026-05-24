# 异常处理规范

本文件约束 Akari 项目中所有代码的异常处理方式。违反以下规则将导致 bug 被静默吞掉（如「归档变失败」这类难以复现的问题）。

---

## 1. 核心原则：禁止吞异常

### ❌ 绝对禁止

```typescript
// 禁止：空 catch
try {
  doSomething()
} catch {
  // ignore
}

// 禁止：只注释不处理
try {
  updateStatus(id, 'archived')
} catch {
  // already in terminal state
}

// 禁止：console.error 但不告知用户（前端）
.catch(err => console.error('[xxx] failed:', err))

// 禁止：catch 后直接 return，丢失错误上下文
async function foo() {
  try {
    await bar()
  } catch {
    return
  }
}
```

### ✅ 正确替代

```typescript
// 后端：预期内的状态机冲突 → 用类型守卫代替 try/catch
if (validateTransition(session.status, 'archived')) {
  updateStatus(id, 'archived')
}

// 后端：真正需要容忍失败的清理操作 → 明确注释原因 + 记日志
try {
  await removeWorktree(id)
} catch (err) {
  fastify.log.warn({ err, sessionId: id }, 'removeWorktree failed during cleanup, continuing')
}

// 前端：用户操作失败 → 必须 toast
.catch(err => {
  console.error('[archiveSession] failed:', err)
  toast.error(`归档失败：${err instanceof Error ? err.message : String(err)}`)
})
```

---

## 2. 前端规范（`apps/web`）

### 2.1 所有用户触发的操作必须 toast 错误

凡是由用户点击按钮、提交表单、拖拽等操作触发的 `fetch` / `async` 调用，失败时必须展示 toast。

```typescript
// ✅ 正确
archiveSession: (id) => {
  fetch(`${API_BASE}/sessions/${id}/archive`, { method: 'POST', ... })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // 更新 store...
    })
    .catch(err => {
      console.error('[archiveSession]', err)
      toast.error(`归档失败：${err instanceof Error ? err.message : String(err)}`)
    })
},
```

### 2.2 非用户触发的后台操作（WebSocket、定时器）→ 静默降级但记录日志

```typescript
// ✅ 正确：WS 消息处理失败不弹 toast，但要 console.error
case 'diff:update':
  try {
    updateDiff(msg.payload)
  } catch (err) {
    console.error('[handleServerMessage] diff:update failed:', err)
    // 不 toast，不影响用户当前操作
  }
  break
```

### 2.3 HTTP 响应非 2xx 必须抛出

```typescript
// ✅ 正确：先检查 ok，再解析 body
const res = await fetch(url, options)
if (!res.ok) {
  const body = await res.json().catch(() => ({}))
  throw new Error(body?.error ?? `HTTP ${res.status}`)
}
```

### 2.4 Toast 消息格式

| 场景 | 调用 |
|------|------|
| 操作成功（可选） | `toast.success('xxx 成功')` |
| 用户操作失败 | `toast.error('xxx 失败：' + err.message)` |
| 后台警告（不阻断） | `toast.warning('xxx')` |
| 加载中（长操作） | `const id = toast.loading('xxx'); toast.dismiss(id)` |

---

## 3. 后端规范（`apps/server`）

### 3.1 业务逻辑层（SessionManager / WorktreeManager 等）

**不允许吞掉会改变系统状态的操作的异常。**

```typescript
// ❌ 禁止：updateStatus 抛异常却不处理，导致状态机静默错误
try {
  this.updateStatus(sessionId, 'archived')
} catch {
  // 被吞掉，session 状态未变，后续 terminal:exit 把它改成 failed
}

// ✅ 正确：用守卫代替异常
if (validateTransition(session.status, 'archived')) {
  this.updateStatus(sessionId, 'archived')
} else {
  this.fastify?.log.warn(
    { sessionId, from: session.status, to: 'archived' },
    'archiveSession: skipping invalid transition'
  )
}
```

### 3.2 清理操作（worktree 删除、PTY kill 等）

清理操作失败可以继续，但必须记录 warn 级别日志，且注释说明"为何可继续"。

```typescript
// ✅ 正确
await this.worktreeManager.removeWorktree(id, branchName).catch(err =>
  console.warn(`[SessionManager] removeWorktree failed for ${id} (non-fatal):`, err)
)
```

### 3.3 Route Handler 层（`index.ts`）

Fastify route handler 抛出的错误由框架统一捕获并返回 500，**不需要额外 try/catch**。但主动的业务错误要返回语义化状态码：

```typescript
// ✅ 正确
fastify.post('/sessions/:id/archive', async (request, reply) => {
  const session = sessionManager.getSession(id)
  if (!session) return reply.status(404).send({ error: 'session not found' })
  // 不需要 try/catch，sessionManager 内部有自己的错误处理
  sessionManager.archiveSession(id)
  return { ok: true }
})
```

### 3.4 `initSession` / 后台 async 操作

后台 async 操作（`.catch()` 或 `void` 调用）必须有错误日志，不得静默失败：

```typescript
// ✅ 正确
this.initSession(session).catch(err => {
  console.error(`[SessionManager] initSession failed for ${session.id}:`, err)
})
```

---

## 4. 状态机相关规范

**不要用 try/catch 掩盖非法状态转换，要在转换前用 `validateTransition()` 守卫。**

```typescript
// ❌ 禁止：依赖 catch 吞掉非法转换
try {
  this.updateStatus(id, newStatus)
} catch { /* ignored */ }

// ✅ 正确：转换前先验证
if (!validateTransition(session.status, newStatus)) {
  log.warn(`Skipping invalid transition ${session.status} → ${newStatus} for session ${id}`)
  return
}
this.updateStatus(id, newStatus)
```

---

## 5. 例外情形（允许静默的场景）

以下场景允许静默处理，但**必须有内联注释说明原因**：

| 场景 | 示例 | 必须注释内容 |
|------|------|--------------|
| 幂等性检查 | `this.terminals.has(id)` 提前 return | "已存在则跳过，防止重复初始化" |
| 连接关闭时的写入 | WS send 在 close 后 | "客户端已断开，忽略发送失败" |
| git prune 等清理 | `git worktree prune` 失败 | "prune 失败不影响主流程" |
| 数据库只读查询降级 | 查询失败返回 `[]` | "降级返回空列表，不阻断渲染" |

---

## 6. 检查清单（每次 Code Review）

- [ ] 所有 `.catch()` 都调用了 `toast.error()`（前端用户操作）或 `log.warn/error()`（后端/后台）
- [ ] 没有空 `catch {}` 块
- [ ] 没有只写 `// ignore` / `// already in terminal state` 的 catch
- [ ] 状态机转换前有 `validateTransition()` 守卫，而不是靠 catch 吞掉
- [ ] HTTP fetch 响应非 2xx 会抛出（`if (!res.ok) throw new Error(...)`）
