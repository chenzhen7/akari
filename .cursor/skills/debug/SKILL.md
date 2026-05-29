---
name: debug
description: 在不能直接判断 bug 根因时，先在关键位置插入诊断日志、让用户复现并回传日志，再基于真实数据修复，最后清理日志。Use when user says 开启调试模式 / 加日志 / 加 console.log / 打日志看看 / 我把日志发给你 / debug mode / instrument，或者出现“代码看着应该对、但运行结果不符合预期”的疑难 bug。

---

# /debug

用于"看代码看不出来、必须看运行时数据才能定位"的 bug 调试。核心原则：**不猜，让数据说话**。

## 目标

- 在最少的关键位置插入有信息量的日志
- 让用户复现一次拿到真实日志
- 基于日志诊断根因，而不是基于猜测
- 修复后清理掉调试日志（除非确认有长期价值）

## 何时使用

✅ 适用：

- 代码看上去逻辑没问题，但运行结果与预期不符
- 用户报告的报错涉及数据库查询、外部 API、复杂分支条件，肉眼无法判断哪一步失败
- 已有的报错信息太笼统（如 "validation failed"），需要更细粒度的上下文
- 怀疑数据形状/类型/边界值与代码假设不一致

❌ 不适用：

- 已经能从代码静态读出根因（直接修就行，别加日志凑数）
- 编译/类型错误（用类型系统/编译器报错就够）
- 只需要 grep 一下就能找到答案的问题

## 执行流程

### 1. 定位嫌疑区段（不要全文撒网）

只在可能"偷偷出错"的地方插日志，典型嫌疑点：

- **入参边界**：函数刚进入时的入参（尤其外部传入的 id、index、status）
- **数据库/外部查询前后**：查询条件 + 命中数 + 命中行的关键字段
- **分支决策点**：if/switch 命中的分支与决策依据的变量值
- **数据转换前后**：解析 JSON、序列化、map/filter/reduce 前后的值
- **错误抛出前**：throw/throwCutGoError 之前，把所有用于判断的状态都打出来

### 2. 加"对照组"查询（可选但很有用）

当怀疑是过滤条件不匹配数据时，在过滤查询旁边加一条**不带过滤**或**放宽过滤**的查询，把全集打印出来对比。例如：

```ts
// 目标查询
const candidates = await prisma.shot.findMany({
  where: { episodeId, index: { gt: shot.index }, imageType: "keyframe" },
})

// 对照查询：本集所有 shot，看实际数据形状
const allInEpisode = await prisma.shot.findMany({
  where: { episodeId },
  select: { id: true, index: true, imageType: true },
})
console.log("[debug-name] all shots in episode:", allInEpisode)
```

这种对照能直接揭示"实际值不是预期字符串/类型/大小写"之类的脏数据问题。

### 3. 日志格式约定

- **统一前缀标签**：所有日志带相同前缀，方便用户 grep/复制。前缀用功能名，不用 `[debug]`，例如 `[compose-first-last]`、`[scriptline-merge]`
- **结构化输出**：传对象给 `console.log`，不要拼字符串。便于阅读 + 不丢类型
- **关键节点打 `=== START ===` / `=== END ===`**：方便用户定位一次执行的边界
- **打字段时只挑相关字段**：不要把整行 row 打出来污染日志，挑 id / index / 状态字段
- **数组只打概要**：`{ count: arr.length, items: arr.map(x => ({ id, key })) }`，避免长内容
- **字符串截断**：长字符串用 `.slice(0, 20)` 截断后加 `...`

参考模板：

```ts
console.log("[feature-name] === START ===", { input })
console.log("[feature-name] current entity:", { id, index, status })
console.log("[feature-name] query:", { whereClause })
console.log("[feature-name] result:", {
  count: result.length,
  items: result.map(r => ({ id: r.id, index: r.index, type: r.type })),
})
```

### 4. 告诉用户怎么操作

加完日志后，必须告诉用户：

- 复现方式（点哪个按钮 / 跑哪个命令）
- 在哪里看日志（浏览器 Console / 终端 / Electron 主进程窗口）
- 日志的关键标签前缀，方便 grep
- **同时列出你目前最大的两到三个怀疑方向**，让用户带着假设看日志

### 5. 等用户回传

- 不要在没有日志的情况下乱猜然后改代码
- 收到日志后，先用一两句话总结"日志说明了什么"，再下结论
- 如果日志还不够定位，承认日志不够、再补一轮，而不是硬猜

### 6. 修复 + 清理

修复后默认**移除**所有为本次 debug 加的日志：

- 用统一前缀标签可以一把 grep 出来
- 仅当日志有长期价值（生产可观测、其他 bug 可能复用）才保留，并改成更正式的 logger 调用

## 改动边界

- 只在嫌疑路径上加日志，不顺手给整个文件加
- 不改业务逻辑（包括"顺手优化"），日志是只读观察手段
- 不在日志里打印密钥、token、明文密码、整段用户内容（截断或脱敏）
- 不要在循环热点里无节制打印（必要时加计数限流，例如只打前 3 条）

## 默认口径

- 用户说"开启调试模式"、"加点日志"、"打日志看看"、"我把日志发给你" 时自动应用本技能
- 用户描述了一个看代码看不出来的运行时 bug 时主动建议本技能（先加日志而不是猜测式修改）
- 加完日志后**停下来等用户**，不要自顾自地改代码
- 修复完成后主动询问"是否需要清理调试日志"