> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Hooks 参考

> Claude Code hook 事件、配置架构、JSON 输入/输出格式、退出代码、异步 hooks、HTTP hooks、提示 hooks 和 MCP 工具 hooks 的参考。

<Tip>
  有关包含示例的快速入门指南，请参阅[使用 hooks 自动化工作流](/zh-CN/hooks-guide)。
</Tip>

Hooks 是用户定义的 shell 命令、HTTP 端点或 LLM 提示，在 Claude Code 生命周期中的特定点自动执行。使用此参考查找事件架构、配置选项、JSON 输入/输出格式以及异步 hooks、HTTP hooks 和 MCP 工具 hooks 等高级功能。如果您是第一次设置 hooks，请改为从[指南](/zh-CN/hooks-guide)开始。

## Hook 生命周期

Hooks 在 Claude Code 会话期间的特定点触发。当事件触发且匹配器匹配时，Claude Code 会将关于该事件的 JSON 上下文传递给您的 hook 处理程序。对于命令 hooks，输入通过 stdin 到达。对于 HTTP hooks，它作为 POST 请求体到达。您的处理程序随后可以检查输入、采取行动并可选地返回决定。事件分为三种频率：每个会话一次（`SessionStart`、`SessionEnd`）、每轮一次（`UserPromptSubmit`、`Stop`、`StopFailure`）以及代理循环内的每个工具调用（`PreToolUse`、`PostToolUse`）：

<div style={{maxWidth: "500px", margin: "0 auto"}}>
  <Frame>
    <img src="https://mintcdn.com/claude-code/ZIW26Z9pnpsXLhbS/images/hooks-lifecycle.svg?fit=max&auto=format&n=ZIW26Z9pnpsXLhbS&q=85&s=ee23691324deb6501df09bfdae560b64" alt="Hook 生命周期图，显示可选的 Setup 流入 SessionStart，然后是每轮循环，包含 UserPromptSubmit、用于 slash commands 的 UserPromptExpansion、嵌套的代理循环（PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure、PostToolBatch、SubagentStart/Stop、TaskCreated、TaskCompleted）和 Stop 或 StopFailure，然后是 TeammateIdle、PreCompact、PostCompact 和 SessionEnd，Elicitation 和 ElicitationResult 嵌套在 MCP 工具执行内，PermissionDenied 作为 PermissionRequest 的副分支用于自动模式拒绝，WorktreeCreate、WorktreeRemove、Notification、ConfigChange、InstructionsLoaded、CwdChanged 和 FileChanged 作为独立异步事件" width="520" height="1228" data-path="images/hooks-lifecycle.svg" />
  </Frame>
</div>

下表总结了每个事件何时触发。[Hook 事件](#hook-events)部分记录了每个事件的完整输入架构和决定控制选项。

| Event                 | When it fires                                                                                                                                          |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`        | When a session begins or resumes                                                                                                                       |
| `Setup`               | When you start Claude Code with `--init-only`, or with `--init` or `--maintenance` in `-p` mode. For one-time preparation in CI or scripts             |
| `UserPromptSubmit`    | When you submit a prompt, before Claude processes it                                                                                                   |
| `UserPromptExpansion` | When a user-typed command expands into a prompt, before it reaches Claude. Can block the expansion                                                     |
| `PreToolUse`          | Before a tool call executes. Can block it                                                                                                              |
| `PermissionRequest`   | When a permission dialog appears                                                                                                                       |
| `PermissionDenied`    | When a tool call is denied by the auto mode classifier. Return `{retry: true}` to tell the model it may retry the denied tool call                     |
| `PostToolUse`         | After a tool call succeeds                                                                                                                             |
| `PostToolUseFailure`  | After a tool call fails                                                                                                                                |
| `PostToolBatch`       | After a full batch of parallel tool calls resolves, before the next model call                                                                         |
| `Notification`        | When Claude Code sends a notification                                                                                                                  |
| `SubagentStart`       | When a subagent is spawned                                                                                                                             |
| `SubagentStop`        | When a subagent finishes                                                                                                                               |
| `TaskCreated`         | When a task is being created via `TaskCreate`                                                                                                          |
| `TaskCompleted`       | When a task is being marked as completed                                                                                                               |
| `Stop`                | When Claude finishes responding                                                                                                                        |
| `StopFailure`         | When the turn ends due to an API error. Output and exit code are ignored                                                                               |
| `TeammateIdle`        | When an [agent team](/en/agent-teams) teammate is about to go idle                                                                                     |
| `InstructionsLoaded`  | When a CLAUDE.md or `.claude/rules/*.md` file is loaded into context. Fires at session start and when files are lazily loaded during a session         |
| `ConfigChange`        | When a configuration file changes during a session                                                                                                     |
| `CwdChanged`          | When the working directory changes, for example when Claude executes a `cd` command. Useful for reactive environment management with tools like direnv |
| `FileChanged`         | When a watched file changes on disk. The `matcher` field specifies which filenames to watch                                                            |
| `WorktreeCreate`      | When a worktree is being created via `--worktree` or `isolation: "worktree"`. Replaces default git behavior                                            |
| `WorktreeRemove`      | When a worktree is being removed, either at session exit or when a subagent finishes                                                                   |
| `PreCompact`          | Before context compaction                                                                                                                              |
| `PostCompact`         | After context compaction completes                                                                                                                     |
| `Elicitation`         | When an MCP server requests user input during a tool call                                                                                              |
| `ElicitationResult`   | After a user responds to an MCP elicitation, before the response is sent back to the server                                                            |
| `SessionEnd`          | When a session terminates                                                                                                                              |

### Hook 如何解析

要了解这些部分如何组合在一起，请考虑这个 `PreToolUse` hook，它阻止破坏性 shell 命令。`matcher` 缩小到 Bash 工具调用，`if` 条件进一步缩小到匹配 `rm *` 的 Bash 子命令，因此 `block-rm.sh` 仅在两个过滤器都匹配时生成：

```json theme={null}
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```

该脚本从 stdin 读取 JSON 输入，提取命令，如果包含 `rm -rf`，则返回 `permissionDecision` 为 `"deny"`：

```bash theme={null}
#!/bin/bash
# .claude/hooks/block-rm.sh
COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive command blocked by hook"
    }
  }'
else
  exit 0  # no decision; normal permission flow applies
fi
```

现在假设 Claude Code 决定运行 `Bash "rm -rf /tmp/build"`。以下是发生的情况：

<Frame>
  <img src="https://mintcdn.com/claude-code/-tYw1BD_DEqfyyOZ/images/hook-resolution.svg?fit=max&auto=format&n=-tYw1BD_DEqfyyOZ&q=85&s=c73ebc1eeda2037570427d7af1e0a891" alt="Hook 解析流程：PreToolUse 事件触发，匹配器检查 Bash 匹配，if 条件检查 Bash(rm *) 匹配，hook 处理程序运行，结果返回到 Claude Code" width="930" height="290" data-path="images/hook-resolution.svg" />
</Frame>

<Steps>
  <Step title="事件触发">
    `PreToolUse` 事件触发。Claude Code 将工具输入作为 JSON 通过 stdin 发送到 hook：

    ```json theme={null}
    { "tool_name": "Bash", "tool_input": { "command": "rm -rf /tmp/build" }, ... }
    ```
  </Step>

  <Step title="匹配器检查">
    匹配器 `"Bash"` 与工具名称匹配，因此此 hook 组激活。如果您省略匹配器或使用 `"*"`，该组在事件的每次出现时激活。
  </Step>

  <Step title="If 条件检查">
    `if` 条件 `"Bash(rm *)"` 匹配，因为 `rm -rf /tmp/build` 是匹配 `rm *` 的子命令，因此此处理程序生成。如果命令是 `npm test`，`if` 检查会失败，`block-rm.sh` 永远不会运行，避免进程生成开销。`if` 字段是可选的；没有它，匹配组中的每个处理程序都运行。
  </Step>

  <Step title="Hook 处理程序运行">
    脚本检查完整命令并找到 `rm -rf`，因此它将决定打印到 stdout：

    ```json theme={null}
    {
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Destructive command blocked by hook"
      }
    }
    ```

    如果命令是更安全的 `rm` 变体，如 `rm file.txt`，脚本会改为执行 `exit 0`。退出代码 0 且无输出意味着 hook 没有决定要报告，因此工具调用继续通过正常的[权限流程](/zh-CN/permissions)。hook 可以拒绝调用，但保持沉默不会批准它。
  </Step>

  <Step title="Claude Code 对结果采取行动">
    Claude Code 读取 JSON 决定，阻止工具调用，并向 Claude 显示原因。
  </Step>
</Steps>

下面的[配置](#configuration)部分记录了完整的架构，每个[hook 事件](#hook-events)部分记录了您的命令接收的输入以及它可以返回的输出。

## 配置

Hooks 在 JSON 设置文件中定义。配置有三个嵌套级别：

1. 选择要响应的[hook 事件](#hook-events)，如 `PreToolUse` 或 `Stop`
2. 添加[匹配器组](#matcher-patterns)以过滤何时触发，如"仅针对 Bash 工具"
3. 定义一个或多个[hook 处理程序](#hook-handler-fields)以在匹配时运行

有关完整的演练和带注释的示例，请参阅上面的[Hook 如何解析](#how-a-hook-resolves)。

<Note>
  此页面为每个级别使用特定术语：**hook 事件**表示生命周期点，**匹配器组**表示过滤器，**hook 处理程序**表示运行的 shell 命令、HTTP 端点、MCP 工具、提示或代理。"Hook"本身指的是一般功能。
</Note>

### Hook 位置

您定义 hook 的位置决定了其范围：

| 位置                                                          | 范围     | 可共享          |
| :---------------------------------------------------------- | :----- | :----------- |
| `~/.claude/settings.json`                                   | 您的所有项目 | 否，本地于您的计算机   |
| `.claude/settings.json`                                     | 单个项目   | 是，可以提交到仓库    |
| `.claude/settings.local.json`                               | 单个项目   | 否，gitignored |
| 托管策略设置                                                      | 组织范围   | 是，管理员控制      |
| [Plugin](/zh-CN/plugins) `hooks/hooks.json`                 | 启用插件时  | 是，与插件捆绑      |
| [Skill](/zh-CN/skills) 或[代理](/zh-CN/sub-agents) frontmatter | 组件活跃时  | 是，在组件文件中定义   |

有关设置文件解析的详细信息，请参阅[设置](/zh-CN/settings)。企业管理员可以使用 `allowManagedHooksOnly` 来阻止用户、项目和插件 hooks。在托管设置 `enabledPlugins` 中强制启用的插件中的 Hooks 是豁免的，因此管理员可以通过组织市场分发经过审查的 hooks。请参阅[Hook 配置](/zh-CN/settings#hook-configuration)。
### Hook 配置

这些设置控制允许运行哪些 hooks 以及 HTTP hooks 可以访问什么。`allowManagedHooksOnly` 设置只能在 [managed 设置](#settings-files)中配置。URL 和环境变量允许列表可以在任何设置级别设置并跨源合并。

**当 `allowManagedHooksOnly` 为 `true` 时的行为：**

* 加载 Managed hooks 和 SDK hooks
* 从在 managed 设置 `enabledPlugins` 中强制启用的插件加载 Hooks。这让管理员通过组织市场分发经过审查的 hooks，同时阻止其他所有内容。信任由完整的 `plugin@marketplace` ID 授予，因此来自不同市场的同名插件保持被阻止
* 用户 hooks、项目 hooks 和所有其他插件 hooks 被阻止

**限制 HTTP hook URL：**

限制 HTTP hooks 可以针对的 URL。支持 `*` 作为匹配的通配符。定义数组后，针对不匹配 URL 的 HTTP hooks 被静默阻止。主机名匹配不区分大小写，忽略尾部 FQDN 点，匹配 DNS 语义。

```json theme={null}
{
  "allowedHttpHookUrls": ["https://hooks.example.com/*", "http://localhost:*"]
}
```

**限制 HTTP hook 环境变量：**

限制 HTTP hooks 可以插入到标头值中的环境变量名称。每个 hook 的有效 `allowedEnvVars` 是其自己列表与此设置的交集。

```json theme={null}
{
  "httpHookAllowedEnvVars": ["MY_TOKEN", "HOOK_SECRET"]
}
```

### 使用策略助手计算 managed 设置

`policyHelper` 设置指向一个可执行文件，在启动时动态计算 managed 设置，因此管理员可以从设备状态、身份或远程服务而不是静态文件派生策略。从 MDM 或系统 `managed-settings.json` 文件配置它。Claude Code 在 `policyHelper` 出现在任何其他作用域时忽略它，包括用户设置、项目设置、HKCU 注册表配置单元和[服务器管理的设置](/zh-CN/server-managed-settings)。

该设置接受这些键：

| 键                   | 类型     | 描述                                     |
| ------------------- | ------ | -------------------------------------- |
| `path`              | string | 助手可执行文件的绝对路径                           |
| `timeoutMs`         | number | 在将运行视为失败之前等待助手多长时间                     |
| `refreshIntervalMs` | number | 在后台重新运行助手的频率。设置为 `0` 以禁用刷新，或至少 `60000` |

助手将 JSON 信封写入 stdout。将设置放在 `managedSettings` 键下而不是顶级，因为裸设置对象解析时 `managedSettings` 未定义并应用任何内容：

```json theme={null}
{
  "managedSettings": {
    "permissions": { "deny": ["Read(//etc/secrets/**)"] }
  },
  "claudeMd": "# Organization context\n...",
  "appendSystemPrompt": "Always cite the internal style guide."
}
```

当助手发出 `managedSettings` 时，该对象替换该运行的基于文件的 managed 设置。当助手在启动时以非零状态退出时，Claude Code 打印错误并拒绝启动，因此需要中断恢复的助手应从其自己的缓存提供并以 `0` 退出。

### 设置优先级

设置按优先级顺序应用。从最高到最低：

1. **Managed 设置**（[服务器管理](/zh-CN/server-managed-settings)、[MDM/OS 级别策略](#configuration-scopes) 或 [managed 设置](/zh-CN/settings#settings-files)）
   * 由 IT 通过服务器交付、MDM 配置文件、注册表策略或 managed 设置文件部署的策略
   * 无法被任何其他级别覆盖，包括命令行参数
   * 在 managed 层内，优先级为：server-managed > MDM/OS 级别策略 > 基于文件（`managed-settings.d/*.json` + `managed-settings.json`）> HKCU 注册表（仅 Windows）。仅使用一个 managed 源；源不合并跨层。在基于文件的层内，放入文件和基础文件被合并在一起。

2. **命令行参数**
   * 特定会话的临时覆盖。通过 `--settings <file-or-json>` 传递的 JSON 使用与其他层相同的规则与基于文件的设置合并：此处设置的键覆盖本地、项目或用户设置中的相同键，省略键会保留较低层的值

3. **本地项目设置**（`.claude/settings.local.json`）
   * 个人项目特定设置

4. **共享项目设置**（`.claude/settings.json`）
   * 源代码管理中的团队共享项目设置

5. **用户设置**（`~/.claude/settings.json`）
   * 个人全局设置

此层次结构确保组织策略始终被强制执行，同时仍允许团队和个人自定义其体验。无论您从 CLI、[VS Code 扩展](/zh-CN/vs-code) 还是 [JetBrains IDE](/zh-CN/jetbrains) 运行 Claude Code，相同的优先级都适用。

例如，如果您的用户设置允许 `Bash(npm run *)`，但项目的共享设置拒绝它，则项目设置优先，命令被阻止。

<Note>
  **数组设置跨作用域合并。** 当相同的数组值设置（例如 `sandbox.filesystem.allowWrite` 或 `permissions.allow`）出现在多个作用域中时，数组被**连接和去重**，而不是替换。这意味着较低优先级的作用域可以添加条目而不覆盖由较高优先级作用域设置的条目，反之亦然。例如，如果 managed 设置将 `allowWrite` 设置为 `["/opt/company-tools"]`，用户添加 `["~/.kube"]`，则最终配置中包含两个路径。
</Note>

### 匹配器模式

`matcher` 字段过滤 hooks 何时触发。匹配器的评估方式取决于它包含的字符：

| 匹配器值              | 评估为                    | 示例                                                                        |
| :---------------- | :--------------------- | :------------------------------------------------------------------------ |
| `"*"`、`""` 或省略    | 匹配所有                   | 在事件的每次出现时触发                                                               |
| 仅字母、数字、`_` 和 `\|` | 精确字符串或 `\|` 分隔的精确字符串列表 | `Bash` 仅匹配 Bash 工具；`Edit\|Write` 精确匹配任一工具                                 |
| 包含任何其他字符          | JavaScript 正则表达式       | `^Notebook` 匹配任何以 Notebook 开头的工具；`mcp__memory__.*` 匹配来自 `memory` 服务器的每个工具 |

`FileChanged` 事件在构建其监视列表时不遵循这些规则。请参阅 [FileChanged](#filechanged)。

每个事件类型在不同的字段上匹配：

| 事件                                                                                                                       | 匹配器过滤的内容                                  | 示例匹配器值                                                                                                                                                        |
| :----------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`PermissionDenied`                                   | 工具名称                                      | `Bash`、`Edit\|Write`、`mcp__.*`                                                                                                                                |
| `SessionStart`                                                                                                           | 会话如何启动                                    | `startup`、`resume`、`clear`、`compact`                                                                                                                          |
| `Setup`                                                                                                                  | 哪个 CLI 标志触发了设置                            | `init`、`maintenance`                                                                                                                                          |
| `SessionEnd`                                                                                                             | 会话为何结束                                    | `clear`、`resume`、`logout`、`prompt_input_exit`、`bypass_permissions_disabled`、`other`                                                                           |
| `Notification`                                                                                                           | 通知类型                                      | `permission_prompt`、`idle_prompt`、`auth_success`、`elicitation_dialog`、`elicitation_complete`、`elicitation_response`                                           |
| `SubagentStart`                                                                                                          | 代理类型                                      | `general-purpose`、`Explore`、`Plan` 或自定义代理名称                                                                                                                   |
| `PreCompact`、`PostCompact`                                                                                               | 触发压缩的原因                                   | `manual`、`auto`                                                                                                                                               |
| `SubagentStop`                                                                                                           | 代理类型                                      | 与 `SubagentStart` 相同的值                                                                                                                                        |
| `ConfigChange`                                                                                                           | 配置源                                       | `user_settings`、`project_settings`、`local_settings`、`policy_settings`、`skills`                                                                                |
| `CwdChanged`                                                                                                             | 不支持匹配器                                    | 总是在每次目录更改时触发                                                                                                                                                  |
| `FileChanged`                                                                                                            | 文字文件名以监视（请参阅 [FileChanged](#filechanged)） | `.envrc\|.env`                                                                                                                                                |
| `StopFailure`                                                                                                            | 错误类型                                      | `rate_limit`、`authentication_failed`、`oauth_org_not_allowed`、`billing_error`、`invalid_request`、`model_not_found`、`server_error`、`max_output_tokens`、`unknown` |
| `InstructionsLoaded`                                                                                                     | 加载原因                                      | `session_start`、`nested_traversal`、`path_glob_match`、`include`、`compact`                                                                                      |
| `UserPromptExpansion`                                                                                                    | 命令名称                                      | 您的 skill 或命令名称                                                                                                                                                |
| `Elicitation`                                                                                                            | MCP 服务器名称                                 | 您配置的 MCP 服务器名称                                                                                                                                                |
| `ElicitationResult`                                                                                                      | MCP 服务器名称                                 | 与 `Elicitation` 相同的值                                                                                                                                          |
| `UserPromptSubmit`、`PostToolBatch`、`Stop`、`TeammateIdle`、`TaskCreated`、`TaskCompleted`、`WorktreeCreate`、`WorktreeRemove` | 不支持匹配器                                    | 总是在每次出现时触发                                                                                                                                                    |

匹配器针对 Claude Code 在 stdin 上发送给您的 hook 的[JSON 输入](#hook-input-and-output)中的字段运行。对于工具事件，该字段是 `tool_name`。每个[hook 事件](#hook-events)部分列出了完整的匹配器值集和该事件的输入架构。

此示例仅在 Claude 写入或编辑文件时运行 linting 脚本：

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/lint-check.sh"
          }
        ]
      }
    ]
  }
}
```

`UserPromptSubmit`、`PostToolBatch`、`Stop`、`TeammateIdle`、`TaskCreated`、`TaskCompleted`、`WorktreeCreate`、`WorktreeRemove` 和 `CwdChanged` 不支持匹配器，总是在每次出现时触发。如果您向这些事件添加 `matcher` 字段，它会被静默忽略。

对于工具事件，您可以通过在单个 hook 处理程序上设置[`if` 字段](#common-fields)来更狭隘地过滤。`if` 使用[权限规则语法](/zh-CN/permissions)来匹配工具名称和参数，因此 `"Bash(git *)"` 仅在任何 Bash 输入的子命令与 `git *` 匹配时运行，`"Edit(*.ts)"` 仅对 TypeScript 文件运行。

#### 匹配 MCP 工具

[MCP](/zh-CN/mcp) 服务器工具在工具事件中显示为常规工具（`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`PermissionDenied`），因此您可以像匹配任何其他工具名称一样匹配它们。

MCP 工具遵循命名模式 `mcp__<server>__<tool>`，例如：

* `mcp__memory__create_entities`：Memory 服务器的创建实体工具
* `mcp__filesystem__read_file`：Filesystem 服务器的读取文件工具
* `mcp__github__search_repositories`：GitHub 服务器的搜索工具

要匹配来自服务器的每个工具，请在服务器前缀后追加 `.*`。`.*` 是必需的：像 `mcp__memory` 这样的匹配器仅包含字母和下划线，因此它作为精确字符串进行比较，不匹配任何工具。

* `mcp__memory__.*` 匹配来自 `memory` 服务器的所有工具
* `mcp__.*__write.*` 匹配来自任何服务器的任何名称以 `write` 开头的工具

此示例记录所有内存服务器操作并验证来自任何 MCP 服务器的写入操作：

```json theme={null}
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__memory__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Memory operation initiated' >> ~/mcp-operations.log"
          }
        ]
      },
      {
        "matcher": "mcp__.*__write.*",
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/scripts/validate-mcp-write.py"
          }
        ]
      }
    ]
  }
}
```

### Hook 处理程序字段

内部 `hooks` 数组中的每个对象都是一个 hook 处理程序：当匹配器匹配时运行的 shell 命令、HTTP 端点、MCP 工具、LLM 提示或代理。有五种类型：

* **[命令 hooks](#command-hook-fields)**（`type: "command"`）：运行 shell 命令。您的脚本在 stdin 上接收事件的[JSON 输入](#hook-input-and-output)，并通过退出代码和 stdout 传回结果。
* **[HTTP hooks](#http-hook-fields)**（`type: "http"`）：将事件的 JSON 输入作为 HTTP POST 请求发送到 URL。端点通过使用与命令 hooks 相同的[JSON 输出格式](#json-output)的响应体传回结果。
* **[MCP 工具 hooks](#mcp-tool-hook-fields)**（`type: "mcp_tool"`）：在已连接的[MCP 服务器](/zh-CN/mcp)上调用工具。工具的文本输出被视为命令 hook stdout。
* **[提示 hooks](#prompt-and-agent-hook-fields)**（`type: "prompt"`）：向 Claude 模型发送提示以进行单轮评估。模型返回 yes/no 决定作为 JSON。请参阅[基于提示的 hooks](#prompt-based-hooks)。
* **[代理 hooks](#prompt-and-agent-hook-fields)**（`type: "agent"`）：生成一个可以使用 Read、Grep 和 Glob 等工具来验证条件的 subagent，然后返回决定。代理 hooks 是实验性的，可能会改变。请参阅[基于代理的 hooks](#agent-based-hooks)。

#### 通用字段

这些字段适用于所有 hook 类型：

| 字段              | 必需 | 描述                                                                                                                                                                                                                                                                      |
| :-------------- | :- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | 是  | `"command"`、`"http"`、`"mcp_tool"`、`"prompt"` 或 `"agent"`                                                                                                                                                                                                                |
| `if`            | 否  | 权限规则语法以过滤此 hook 何时运行，例如 `"Bash(git *)"` 或 `"Edit(*.ts)"`。仅当工具调用与模式匹配时，hook 才会生成，或当 Bash 命令太复杂而无法解析时。仅在工具事件上评估：`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest` 和 `PermissionDenied`。在其他事件上，设置了 `if` 的 hook 永远不会运行。使用与[权限规则](/zh-CN/permissions)相同的语法 |
| `timeout`       | 否  | 取消前的秒数。默认值：`command`、`http` 和 `mcp_tool` 为 600；`prompt` 为 30；`agent` 为 60。[`UserPromptSubmit`](#userpromptsubmit) 将 `command`、`http` 和 `mcp_tool` 的默认值降低到 30                                                                                                            |
| `statusMessage` | 否  | hook 运行时显示的自定义加载程序消息                                                                                                                                                                                                                                                    |
| `once`          | 否  | 如果为 `true`，每个会话仅运行一次，然后被移除。仅在[skill frontmatter](#hooks-in-skills-and-agents)中声明的 hooks 中受尊重；在设置文件和代理 frontmatter 中被忽略                                                                                                                                                  |

`if` 字段恰好包含一个权限规则。没有 `&&`、`||` 或列表语法来组合规则；要应用多个条件，请为每个条件定义一个单独的 hook 处理程序。对于 Bash，规则针对工具输入的每个子命令进行匹配，在去除前导 `VAR=value` 赋值后，因此 `if: "Bash(git push *)"` 既匹配 `FOO=bar git push` 也匹配 `npm test && git push`。如果任何子命令匹配，hook 会运行，并且在命令太复杂而无法解析时总是运行。

#### 命令 hook 字段

除了[通用字段](#common-fields)外，命令 hooks 还接受这些字段：

| 字段            | 必需 | 描述                                                                                                                                                                             |
| :------------ | :- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`     | 是  | 要执行的 shell 命令。与 `args` 一起，要直接生成的可执行文件。请参阅[Exec 形式和 shell 形式](#exec-form-and-shell-form)                                                                                        |
| `args`        | 否  | 参数列表。存在时，`command` 被解析为可执行文件并直接使用 `args` 作为参数向量生成，不涉及 shell。请参阅[Exec 形式和 shell 形式](#exec-form-and-shell-form)                                                                  |
| `async`       | 否  | 如果为 `true`，在后台运行而不阻止。请参阅[在后台运行 hooks](#run-hooks-in-the-background)                                                                                                            |
| `asyncRewake` | 否  | 如果为 `true`，在后台运行并在退出代码 2 时唤醒 Claude。暗示 `async`。Hook 的 stderr，或 stdout（如果 stderr 为空），作为系统提醒显示给 Claude，以便它可以对长时间运行的后台失败做出反应                                                      |
| `shell`       | 否  | 用于此 hook 的 shell。接受 `"bash"`（默认）或 `"powershell"`。设置 `"powershell"` 在 Windows 上通过 PowerShell 运行命令。不需要 `CLAUDE_CODE_USE_POWERSHELL_TOOL`，因为 hooks 直接生成 PowerShell。设置 `args` 时被忽略 |

<a id="exec-form-and-shell-form" />

##### Exec 形式和 shell 形式

当设置 `args` 时，命令 hook 以 exec 形式运行，当省略 `args` 时以 shell 形式运行。每当 hook 引用[路径占位符](#reference-scripts-by-path)时设置 `args`，因为每个元素作为一个参数传递，不带引号。当您需要 shell 功能（如管道或 `&&`）时，或当两个问题都不适用时，省略 `args`。

**Exec 形式**在存在 `args` 时运行。Claude Code 在 `PATH` 上解析 `command` 作为可执行文件，并直接使用 `args` 作为参数向量生成它。没有 shell，因此每个 `args` 元素恰好是一个参数，完全按照编写的方式，路径占位符如 `${CLAUDE_PLUGIN_ROOT}` 被替换为 `command` 和每个 `args` 元素中的纯字符串。特殊字符如撇号、`$` 和反引号逐字通过，因为没有 shell 来解释它们。在任何平台上都不会发生 shell 标记化。

**Shell 形式**在省略 `args` 时运行。`command` 字符串被传递给 shell：在 macOS 和 Linux 上为 `sh -c`，在 Windows 上为 Git Bash，或在未安装 Git Bash 时为 PowerShell。设置 `shell` 字段以显式选择。shell 标记化字符串，展开变量，并解释管道、`&&`、重定向和 glob。

<Note>
  在 Windows 上，exec 形式需要 `command` 解析为真实可执行文件，如 `.exe`。npm、npx、eslint 和其他工具在 `node_modules/.bin` 中安装的 `.cmd` 和 `.bat` 垫片不是可执行文件，不能在没有 shell 的情况下生成。要在 exec 形式中运行它们，直接使用 `node` 调用底层脚本，例如 `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]`。`node` 加脚本路径模式在每个平台上都有效，因为 `node.exe` 是真实二进制文件。要按名称运行 `.cmd` 或 `.bat` 垫片，请使用 shell 形式。
</Note>

此示例运行与插件捆绑的 Node 脚本。Exec 形式将解析的脚本路径作为一个参数传递，不带引号：

```json theme={null}
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js", "--fix"]
}
```

等效的 shell 形式需要引号来处理包含空格或特殊字符的路径：

```json theme={null}
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/scripts/format.js --fix"
}
```

两种形式都支持相同的[路径占位符](#reference-scripts-by-path)，并且都将它们作为环境变量 `CLAUDE_PROJECT_DIR`、`CLAUDE_PLUGIN_ROOT` 和 `CLAUDE_PLUGIN_DATA` 导出到生成的进程上，因此脚本可以读取 `process.env.CLAUDE_PLUGIN_ROOT`，无论它是如何启动的。插件 hooks 另外替换 `${user_config.*}` 值；请参阅[用户配置](/zh-CN/plugins-reference#user-configuration)。

<Note>
  在 exec 形式中，`command` 仅是可执行文件名或路径。如果 `command` 是没有路径分隔符的裸名称，并且与 `args` 一起包含空格，Claude Code 会记录警告，因为生成会失败：没有名为 `node script.js` 的可执行文件。将额外的令牌移到 `args` 中。包含空格的绝对路径，如 `C:\Program Files\nodejs\node.exe`，是单个有效的可执行文件，不会触发警告。
</Note>

#### HTTP hook 字段

除了[通用字段](#common-fields)外，HTTP hooks 还接受这些字段：

| 字段               | 必需 | 描述                                                                                      |
| :--------------- | :- | :-------------------------------------------------------------------------------------- |
| `url`            | 是  | 发送 POST 请求的 URL                                                                         |
| `headers`        | 否  | 其他 HTTP 标头作为键值对。值支持使用 `$VAR_NAME` 或 `${VAR_NAME}` 语法的环境变量插值。仅解析 `allowedEnvVars` 中列出的变量 |
| `allowedEnvVars` | 否  | 可能被插值到标头值中的环境变量名称列表。对未列出变量的引用被替换为空字符串。任何环境变量插值都需要此项                                     |

Claude Code 使用 `Content-Type: application/json` 将 hook 的[JSON 输入](#hook-input-and-output)作为 POST 请求体发送。响应体使用与命令 hooks 相同的[JSON 输出格式](#json-output)。

错误处理与命令 hooks 不同：非 2xx 响应、连接失败和超时都会产生非阻止错误，允许执行继续。要阻止工具调用或拒绝权限，返回 2xx 响应，其 JSON 体包含 `decision: "block"` 或 `hookSpecificOutput` 与 `permissionDecision: "deny"`。

此示例将 `PreToolUse` 事件发送到本地验证服务，使用来自 `MY_TOKEN` 环境变量的令牌进行身份验证：

```json theme={null}
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8080/hooks/pre-tool-use",
            "timeout": 30,
            "headers": {
              "Authorization": "Bearer $MY_TOKEN"
            },
            "allowedEnvVars": ["MY_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

#### MCP 工具 hook 字段

除了[通用字段](#common-fields)外，MCP 工具 hooks 还接受这些字段：

| 字段       | 必需 | 描述                                                                                                     |
| :------- | :- | :----------------------------------------------------------------------------------------------------- |
| `server` | 是  | 已配置的 MCP 服务器的名称。服务器必须已连接；hook 永远不会触发 OAuth 或连接流                                                        |
| `tool`   | 是  | 该服务器上要调用的工具的名称                                                                                         |
| `input`  | 否  | 传递给工具的参数。字符串值支持从 hook 的[JSON 输入](#hook-input-and-output)进行 `${path}` 替换，例如 `"${tool_input.file_path}"` |

工具的文本内容被视为命令 hook stdout：如果它解析为有效的[JSON 输出](#json-output)，则作为决定进行处理，否则显示为纯文本。如果命名的服务器未连接，或工具返回 `isError: true`，hook 会产生非阻止错误，执行继续。

MCP 工具 hooks 在 Claude Code 连接到您的 MCP 服务器后在每个 hook 事件上可用。`SessionStart` 和 `Setup` 通常在服务器完成连接之前触发，因此这些事件上的 hooks 应该期望在首次运行时出现"未连接"错误。

此示例在每个 `Write` 或 `Edit` 后在 `my_server` MCP 服务器上调用 `security_scan` 工具，传递编辑文件的路径：

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "mcp_tool",
            "server": "my_server",
            "tool": "security_scan",
            "input": { "file_path": "${tool_input.file_path}" }
          }
        ]
      }
    ]
  }
}
```

#### 提示和代理 hook 字段

除了[通用字段](#common-fields)外，提示和代理 hooks 还接受这些字段：

| 字段       | 必需 | 描述                                               |
| :------- | :- | :----------------------------------------------- |
| `prompt` | 是  | 要发送给模型的提示文本。使用 `$ARGUMENTS` 作为 hook 输入 JSON 的占位符 |
| `model`  | 否  | 用于评估的模型。默认为快速模型                                  |

所有匹配的 hooks 并行运行，相同的处理程序会自动去重。命令 hooks 按命令字符串和 `args` 去重，HTTP hooks 按 URL 去重。处理程序在当前目录中运行，使用 Claude Code 的环境。在远程 web 环境中，`$CLAUDE_CODE_REMOTE` 环境变量设置为 `"true"`，在本地 CLI 中未设置。

### 按路径引用脚本

使用这些占位符按项目或插件根目录引用 hook 脚本，无论 hook 运行时的工作目录如何：

* `${CLAUDE_PROJECT_DIR}`：项目根目录。
* `${CLAUDE_PLUGIN_ROOT}`：插件的安装目录，用于与[插件](/zh-CN/plugins)捆绑的脚本。在每次插件更新时更改。
* `${CLAUDE_PLUGIN_DATA}`：插件的[持久数据目录](/zh-CN/plugins-reference#persistent-data-directory)，用于应该在插件更新后保留的依赖项和状态。

对于任何引用路径占位符的 hook，优先使用[exec 形式](#exec-form-and-shell-form)。Exec 形式将每个 `args` 元素作为一个参数传递，不带 shell 标记化，因此包含空格或特殊字符的路径不需要引号。在 shell 形式中，用双引号包装每个占位符。

<Tabs>
  <Tab title="项目脚本">
    此示例使用 `${CLAUDE_PROJECT_DIR}` 在任何 `Write` 或 `Edit` 工具调用后从项目的 `.claude/hooks/` 目录运行样式检查器：

    ```json theme={null}
    {
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Write|Edit",
            "hooks": [
              {
                "type": "command",
                "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-style.sh",
                "args": []
              }
            ]
          }
        ]
      }
    }
    ```
  </Tab>

  <Tab title="插件脚本">
    在 `hooks/hooks.json` 中定义插件 hooks，带有可选的顶级 `description` 字段。启用插件时，其 hooks 与您的用户和项目 hooks 合并。

    此示例运行与插件捆绑的格式化脚本：

    ```json theme={null}
    {
      "description": "Automatic code formatting",
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Write|Edit",
            "hooks": [
              {
                "type": "command",
                "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
                "args": [],
                "timeout": 30
              }
            ]
          }
        ]
      }
    }
    ```

    有关创建插件 hooks 的详细信息，请参阅[插件组件参考](/zh-CN/plugins-reference#hooks)。
  </Tab>
</Tabs>

### Skills 和代理中的 Hooks

除了设置文件和插件外，hooks 还可以使用 frontmatter 直接在[skills](/zh-CN/skills)和[subagents](/zh-CN/sub-agents)中定义。这些 hooks 的范围限于组件的生命周期，仅在该组件活跃时运行。

支持所有 hook 事件。对于 subagents，`Stop` hooks 会自动转换为 `SubagentStop`，因为这是 subagent 完成时触发的事件。

Hooks 使用与基于设置的 hooks 相同的配置格式，但范围限于组件的生命周期，并在其完成时清理。

此 skill 定义了一个 `PreToolUse` hook，在每个 `Bash` 命令之前运行安全验证脚本：

```yaml theme={null}
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

代理在其 YAML frontmatter 中使用相同的格式。

### `/hooks` 菜单

在 Claude Code 中键入 `/hooks` 以打开您配置的 hooks 的只读浏览器。菜单显示每个 hook 事件及其配置的 hooks 计数，让您深入了解匹配器，并显示每个 hook 处理程序的完整详细信息。使用它来验证配置、检查 hook 来自哪个设置文件，或检查 hook 的命令、提示或 URL。

菜单显示所有五种 hook 类型：`command`、`prompt`、`agent`、`http` 和 `mcp_tool`。每个 hook 都标有 `[type]` 前缀和指示其定义位置的源：

* `User`：来自 `~/.claude/settings.json`
* `Project`：来自 `.claude/settings.json`
* `Local`：来自 `.claude/settings.local.json`
* `Plugin`：来自插件的 `hooks/hooks.json`
* `Session`：在当前会话中在内存中注册
* `Built-in`：由 Claude Code 内部注册

选择 hook 会打开详细视图，显示其事件、匹配器、类型、源文件以及完整的命令、提示或 URL。菜单是只读的：要添加、修改或移除 hooks，请直接编辑设置 JSON 或要求 Claude 进行更改。

### 禁用或移除 hooks

要移除 hook，请从设置 JSON 文件中删除其条目。

要临时禁用所有 hooks 而不移除它们，请在设置文件中设置 `"disableAllHooks": true`。没有办法在保持 hook 在配置中的同时禁用单个 hook。

`disableAllHooks` 设置遵守托管设置层次结构。如果管理员通过托管策略设置配置了 hooks，则在用户、项目或本地设置中设置的 `disableAllHooks` 无法禁用这些托管 hooks。仅在托管设置级别设置的 `disableAllHooks` 可以禁用托管 hooks。

对设置文件中 hooks 的直接编辑通常由文件监视程序自动拾取。

## Hook 输入和输出

命令 hooks 通过 stdin 接收 JSON 数据，并通过退出代码、stdout 和 stderr 传回结果。HTTP hooks 接收相同的 JSON 作为 POST 请求体，并通过 HTTP 响应体传回结果。本部分涵盖所有事件通用的字段和行为。每个事件在[Hook 事件](#hook-events)下的部分包括其特定的输入架构和决定控制选项。

从 v2.1.139 开始，在 macOS 和 Linux 上，命令 hooks 在没有控制终端的自己的会话中运行。hook 进程和任何子进程无法打开 `/dev/tty` 或直接向 Claude Code 界面发送转义序列。Windows 没有 `/dev/tty`。要在任何平台上向用户显示消息，请在 JSON 输出中返回[`systemMessage`](#json-output)。要触发桌面通知、设置窗口标题或响铃，请改为返回[`terminalSequence`](#emit-terminal-notifications)。

### 通用输入字段

Hook 事件接收这些字段作为 JSON，除了每个[hook 事件](#hook-events)部分中记录的事件特定字段。对于命令 hooks，此 JSON 通过 stdin 到达。对于 HTTP hooks，它作为 POST 请求体到达。

| 字段                | 描述                                                                                                                                                                                                                                                                                                                                                                      |
| :---------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`      | 当前会话标识符                                                                                                                                                                                                                                                                                                                                                                 |
| `transcript_path` | 对话 JSON 的路径                                                                                                                                                                                                                                                                                                                                                             |
| `cwd`             | 调用 hook 时的当前工作目录                                                                                                                                                                                                                                                                                                                                                        |
| `permission_mode` | 当前[权限模式](/zh-CN/permissions#permission-modes)：`"default"`、`"plan"`、`"acceptEdits"`、`"auto"`、`"dontAsk"` 或 `"bypassPermissions"`。并非所有事件都接收此字段：请参阅下面每个事件的 JSON 示例以检查                                                                                                                                                                                                      |
| `effort`          | 对象，其中 `level` 字段保存该轮次的活跃[努力级别](/zh-CN/model-config#adjust-effort-level)：`"low"`、`"medium"`、`"high"`、`"xhigh"` 或 `"max"`。如果请求的努力级别超过当前模型支持的级别，这是模型实际使用的降级级别，而不是您请求的级别。该对象与[状态行](/zh-CN/statusline#available-data) `effort` 字段匹配。存在于在工具使用上下文中触发的事件中，例如 `PreToolUse`、`PostToolUse`、`Stop` 和 `SubagentStop`，当当前模型支持努力参数时。该级别也可作为 `$CLAUDE_EFFORT` 环境变量提供给 hook 命令和 Bash 工具。 |
| `hook_event_name` | 触发的事件名称                                                                                                                                                                                                                                                                                                                                                                 |

使用 `--agent` 运行或在 subagent 内部时，包括两个额外字段：

| 字段           | 描述                                                                                                                                                                                                           |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_id`   | Subagent 的唯一标识符。仅当 hook 在 subagent 调用内触发时存在。使用此来区分 subagent hook 调用和主线程调用。                                                                                                                                   |
| `agent_type` | 代理名称（例如，`"Explore"` 或 `"security-reviewer"`）。当会话使用 `--agent` 或 hook 在 subagent 内触发时存在。对于 subagents，subagent 的类型优先于会话的 `--agent` 值。对于[自定义 subagents](/zh-CN/sub-agents)，这是代理 frontmatter 中的 `name` 字段，而不是文件名。 |

仅[`SessionStart`](#sessionstart) hooks 接收 `model` 字段。没有 `$CLAUDE_MODEL` 环境变量。Hook 进程继承父环境，因此如果您在 shell 中设置了 `$ANTHROPIC_MODEL`，它可以读取该值，但当您在会话期间使用 `/model` 切换模型时，该值不会改变。

例如，Bash 命令的 `PreToolUse` hook 在 stdin 上接收：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test"
  }
}
```

`tool_name` 和 `tool_input` 字段是事件特定的。每个[hook 事件](#hook-events)部分记录了该事件的额外字段。

### 退出代码输出

您的 hook 命令的退出代码告诉 Claude Code 操作是否应该继续、被阻止或被忽略。

**退出 0** 表示成功。Claude Code 解析 stdout 以获取[JSON 输出字段](#json-output)。JSON 输出仅在退出 0 时处理。对于大多数事件，stdout 被写入调试日志，但不显示在成绩单中。例外是 `UserPromptSubmit`、`UserPromptExpansion` 和 `SessionStart`，其中 stdout 作为 Claude 可以看到和作用的上下文添加。

**退出 2** 表示阻止错误。Claude Code 忽略 stdout 和其中的任何 JSON。相反，stderr 文本被反馈给 Claude 作为错误消息。效果取决于事件：`PreToolUse` 阻止工具调用，`UserPromptSubmit` 拒绝提示，等等。有关完整列表，请参阅[每个事件的退出代码 2 行为](#exit-code-2-behavior-per-event)。

**任何其他退出代码** 是大多数 hook 事件的非阻止错误。成绩单显示 `<hook name> hook error` 通知，然后是 stderr 的第一行，因此您可以在不使用 `--debug` 的情况下识别原因。执行继续，完整的 stderr 被写入调试日志。

例如，一个 hook 命令脚本，阻止危险的 Bash 命令：

```bash theme={null}
#!/bin/bash
# 从 stdin 读取 JSON 输入，检查命令
command=$(jq -r '.tool_input.command' < /dev/stdin)

if [[ "$command" == rm* ]]; then
  echo "Blocked: rm commands are not allowed" >&2
  exit 2  # 阻止错误：工具调用被阻止
fi

exit 0  # 无决定：正常权限流程适用
```

<Warning>
  对于大多数 hook 事件，仅退出代码 2 阻止操作。Claude Code 将退出代码 1 视为非阻止错误并继续操作，尽管 1 是传统的 Unix 失败代码。如果您的 hook 旨在强制执行策略，请使用 `exit 2`。例外是 `WorktreeCreate`，其中任何非零退出代码都会中止 worktree 创建。
</Warning>

#### 每个事件的退出代码 2 行为

退出代码 2 是 hook 发出"停止，不要这样做"的方式。效果取决于事件，因为某些事件代表可以被阻止的操作（如尚未发生的工具调用），而其他事件代表已经发生或无法防止的事情。

| Hook 事件               | 可以阻止？ | 退出 2 时发生的情况                                                                |
| :-------------------- | :---- | :------------------------------------------------------------------------- |
| `PreToolUse`          | 是     | 阻止工具调用                                                                     |
| `PermissionRequest`   | 是     | 拒绝权限                                                                       |
| `UserPromptSubmit`    | 是     | 阻止提示处理并从上下文中删除提示                                                           |
| `UserPromptExpansion` | 是     | 阻止扩展                                                                       |
| `Stop`                | 是     | 防止 Claude 停止，继续对话                                                          |
| `SubagentStop`        | 是     | 防止 subagent 停止                                                             |
| `TeammateIdle`        | 是     | 防止队友空闲（队友继续工作）                                                             |
| `TaskCreated`         | 是     | 回滚任务创建                                                                     |
| `TaskCompleted`       | 是     | 防止任务被标记为已完成                                                                |
| `ConfigChange`        | 是     | 阻止配置更改生效（除了 `policy_settings`）                                             |
| `StopFailure`         | 否     | 输出和退出代码被忽略                                                                 |
| `PostToolUse`         | 否     | 向 Claude 显示 stderr（工具已运行）                                                  |
| `PostToolUseFailure`  | 否     | 向 Claude 显示 stderr（工具已失败）                                                  |
| `PostToolBatch`       | 是     | 在下一个模型调用之前停止代理循环                                                           |
| `PermissionDenied`    | 否     | 退出代码和 stderr 被忽略（拒绝已发生）。使用 JSON `hookSpecificOutput.retry: true` 告诉模型它可能重试 |
| `Notification`        | 否     | 仅向用户显示 stderr                                                              |
| `SubagentStart`       | 否     | 仅向用户显示 stderr                                                              |
| `SessionStart`        | 否     | 仅向用户显示 stderr                                                              |
| `Setup`               | 否     | 仅向用户显示 stderr                                                              |
| `SessionEnd`          | 否     | 仅向用户显示 stderr                                                              |
| `CwdChanged`          | 否     | 仅向用户显示 stderr                                                              |
| `FileChanged`         | 否     | 仅向用户显示 stderr                                                              |
| `PreCompact`          | 是     | 阻止压缩                                                                       |
| `PostCompact`         | 否     | 仅向用户显示 stderr                                                              |
| `Elicitation`         | 是     | 拒绝 elicitation                                                             |
| `ElicitationResult`   | 是     | 阻止响应（操作变为 decline）                                                         |
| `WorktreeCreate`      | 是     | 任何非零退出代码都会导致 worktree 创建失败                                                 |
| `WorktreeRemove`      | 否     | 失败仅在调试模式下记录                                                                |
| `InstructionsLoaded`  | 否     | 退出代码被忽略                                                                    |

### HTTP 响应处理

HTTP hooks 使用 HTTP 状态代码和响应体而不是退出代码和 stdout：

* **2xx 带空体**：成功，等同于退出代码 0 且无输出
* **2xx 带纯文本体**：成功，文本作为上下文添加
* **2xx 带 JSON 体**：成功，使用与命令 hooks 相同的[JSON 输出](#json-output)架构解析
* **非 2xx 状态**：非阻止错误，执行继续
* **连接失败或超时**：非阻止错误，执行继续

与命令 hooks 不同，HTTP hooks 无法仅通过状态代码发出阻止错误信号。要阻止工具调用或拒绝权限，返回 2xx 响应，其 JSON 体包含适当的决定字段。

### JSON 输出

退出代码让您允许或阻止，但 JSON 输出提供更细粒度的控制。与其使用代码 2 退出来阻止，不如退出 0 并将 JSON 对象打印到 stdout。Claude Code 从该 JSON 读取特定字段以控制行为，包括[决定控制](#decision-control)以阻止、允许或升级给用户。

<Note>
  您必须为每个 hook 选择一种方法，而不是两种：要么单独使用退出代码进行信号传递，要么退出 0 并打印 JSON 以进行结构化控制。Claude Code 仅在退出 0 时处理 JSON。如果您退出 2，任何 JSON 都会被忽略。
</Note>

您的 hook 的 stdout 必须仅包含 JSON 对象。如果您的 shell 配置文件在启动时打印文本，它可能会干扰 JSON 解析。请参阅故障排除指南中的[JSON 验证失败](/zh-CN/hooks-guide#json-validation-failed)。

Hook 输出字符串，包括 `additionalContext`、`systemMessage` 和纯 stdout，上限为 10,000 个字符。超过此限制的输出被保存到文件并替换为预览和文件路径，与大型工具结果的处理方式相同。

JSON 对象支持三种字段：

* **通用字段**，如 `continue`，在所有事件中工作。这些列在下表中。
* **顶级 `decision` 和 `reason`** 由某些事件用于阻止或提供反馈。
* **`hookSpecificOutput`** 是一个嵌套对象，用于需要更丰富控制的事件。它需要一个设置为事件名称的 `hookEventName` 字段。

| 字段                 | 默认      | 描述                                                                                                                                         |
| :----------------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `continue`         | `true`  | 如果为 `false`，Claude 在 hook 运行后完全停止处理。优先于任何事件特定的决定字段                                                                                         |
| `stopReason`       | 无       | 当 `continue` 为 `false` 时向用户显示的消息。不向 Claude 显示                                                                                              |
| `suppressOutput`   | `false` | 如果为 `true`，从成绩单中隐藏 hook 的 stdout。Stdout 仍然出现在调试日志中                                                                                         |
| `systemMessage`    | 无       | 向用户显示的警告消息                                                                                                                                 |
| `terminalSequence` | 无       | Claude Code 代表您发出的终端转义序列，例如桌面通知、窗口标题或响铃。限制为 OSC `0`/`1`/`2`/`9`/`99`/`777` 和 BEL。如果值包含允许列表之外的任何内容，该字段将被忽略。使用此而不是写入 `/dev/tty`，这对 hooks 不可用 |

要无论事件类型如何都完全停止 Claude：

```json theme={null}
{ "continue": false, "stopReason": "Build failed, fix errors before continuing" }
```

#### 发出终端通知

`terminalSequence` 字段需要 Claude Code v2.1.141 或更高版本。

Hooks 运行时没有控制终端，因此直接向 `/dev/tty` 写入转义序列会失败。相反，在 `terminalSequence` 字段中返回转义序列，Claude Code 通过其自己的终端写入路径为您发出它。这是无竞争的，在 tmux 和 GNU screen 内工作，并在 Windows 上工作，其中没有 `/dev/tty`。

该字段接受一个或多个允许列表转义序列的字符串：

* OSC `0`、`1`、`2`：窗口和图标标题
* OSC `9`：iTerm2、ConEmu、Windows Terminal 和 WezTerm 通知，包括 `9;4` 任务栏进度
* OSC `99`：Kitty 通知
* OSC `777`：urxvt、Ghostty 和 Warp 通知
* 裸 BEL

序列可以用 BEL 或 ST 终止。允许列表之外的任何内容，包括 CSI 光标和颜色序列、OSC 调色板序列、OSC 8 超链接、OSC 52 剪贴板写入和 OSC 1337，都会被拒绝，该字段将被忽略。

下面的示例从 `Notification` hook 触发桌面通知。转义序列使用 `printf` 八进制转义构建，因此控制字节永远不会出现在 shell 命令行上，`jq -n --arg` 构建 JSON 输出，因此通知消息中的引号、反斜杠和换行符被正确转义：

```bash theme={null}
#!/bin/bash
# Notification hook：当 Claude Code 需要注意时 ping 桌面。
input=$(cat)
title="Claude Code'
body=$(jq -r '.message // "Needs your attention"' <<<"$input")
seq=$(printf '\033]777;notify;%s;%s\007' "$title" "$body")
jq -nc --arg seq "$seq" '{terminalSequence: $seq}'
```

`{ "terminalSequence": "..." }` 形状从任何 shell 或语言都相同。在 Windows 上，在 PowerShell 或脚本中构建转义字符串并发出相同的 JSON 对象。

<Note>
  `terminalSequence` 是之前直接向 `/dev/tty` 写入转义序列的 hooks 的受支持替代品。允许列表限制为无法移动光标或改变颜色的序列，因此 hook 永远无法破坏屏幕上的提示。
</Note>

#### 为 Claude 添加上下文

`additionalContext` 字段将来自您的 hook 的字符串传递到 Claude 的上下文窗口中。Claude Code 将字符串包装在系统提醒中，并将其插入到 hook 触发的对话点。Claude 在下一个模型请求时读取提醒，但它不会在界面中显示为聊天消息。

在 `hookSpecificOutput` 中返回 `additionalContext` 以及事件名称：

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "This file is generated. Edit src/schema.ts and run `bun generate` instead."
  }
}
```

提醒出现的位置取决于事件：

* [SessionStart](#sessionstart)、[Setup](#setup) 和 [SubagentStart](#subagentstart)：在对话开始，在第一个提示之前
* [UserPromptSubmit](#userpromptsubmit) 和 [UserPromptExpansion](#userpromptexpansion)：与提交的提示一起
* [PreToolUse](#pretooluse)、[PostToolUse](#posttooluse)、[PostToolUseFailure](#posttoolusefailure) 和 [PostToolBatch](#posttoolbatch)：在工具结果旁边

当多个 hooks 为同一事件返回 `additionalContext` 时，Claude 接收所有值。如果值超过 10,000 个字符，Claude Code 将完整文本写入会话目录中的文件，并将 Claude 传递文件路径以及简短预览。

使用 `additionalContext` 来获取 Claude 应该了解的有关您的环境当前状态或刚刚运行的操作的信息：

* **环境状态**：当前分支、部署目标或活跃的功能标志
* **条件项目规则**：哪个测试命令适用于刚刚编辑的文件，哪些目录在此 worktree 中是只读的
* **外部数据**：分配给您的开放问题、最近的 CI 结果、从内部服务获取的内容

对于永不改变的说明，更倾向于[CLAUDE.md](/zh-CN/memory)。它加载时无需运行脚本，是静态项目约定的标准位置。

将文本写成事实陈述而不是命令式系统指令。措辞如"部署目标是生产"或"此 repo 使用 `bun test`"读作项目信息。框架为带外系统命令的文本可能会触发 Claude 的提示注入防御，这会导致 Claude 将文本呈现给您，而不是将其视为上下文。

一旦注入，文本就会保存在会话成绩单中。对于 `PostToolUse` 或 `UserPromptSubmit` 等中期事件，使用 `--continue` 或 `--resume` 恢复会重放保存的文本，而不是为过去的轮次重新运行 hook，因此时间戳或提交 SHA 等值在恢复时变得陈旧。`SessionStart` hooks 在使用 `source` 设置为 `"resume"` 的 `--resume` 恢复时再次运行，因此它们可以刷新其上下文。

#### 决定控制

并非每个事件都支持通过 JSON 阻止或控制行为。支持的事件各自使用不同的字段集来表达该决定。在编写 hook 之前，使用此表作为快速参考：

| 事件                                                                                                                          | 决定模式                    | 关键字段                                                                                                                                                 |
| :-------------------------------------------------------------------------------------------------------------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| UserPromptSubmit、UserPromptExpansion、PostToolUse、PostToolUseFailure、PostToolBatch、Stop、SubagentStop、ConfigChange、PreCompact | 顶级 `decision`           | `decision: "block"`、`reason`                                                                                                                         |
| TeammateIdle、TaskCreated、TaskCompleted                                                                                      | 退出代码或 `continue: false` | 退出代码 2 使用 stderr 反馈阻止操作。JSON `{"continue": false, "stopReason": "..."}` 也会完全停止队友，匹配 `Stop` hook 行为                                                   |
| PreToolUse                                                                                                                  | `hookSpecificOutput`    | `permissionDecision`（allow/deny/ask/defer）、`permissionDecisionReason`                                                                                |
| PermissionRequest                                                                                                           | `hookSpecificOutput`    | `decision.behavior`（allow/deny）                                                                                                                      |
| PermissionDenied                                                                                                            | `hookSpecificOutput`    | `retry: true` 告诉模型它可能重试被拒绝的工具调用                                                                                                                      |
| WorktreeCreate                                                                                                              | 路径返回                    | 命令 hook 在 stdout 上打印路径；HTTP hook 通过 `hookSpecificOutput.worktreePath` 返回。Hook 失败或缺少路径会导致创建失败                                                         |
| Elicitation                                                                                                                 | `hookSpecificOutput`    | `action`（accept/decline/cancel）、`content`（form 字段值用于 accept）                                                                                         |
| ElicitationResult                                                                                                           | `hookSpecificOutput`    | `action`（accept/decline/cancel）、`content`（form 字段值覆盖）                                                                                                |
| SessionStart、Setup、SubagentStart                                                                                            | 仅上下文                    | `hookSpecificOutput.additionalContext` 为 Claude 添加上下文。SessionStart 也接受[`initialUserMessage` 和 `watchPaths`](#sessionstart-decision-control)。无阻止或决定控制 |
| WorktreeRemove、Notification、SessionEnd、PostCompact、InstructionsLoaded、StopFailure、CwdChanged、FileChanged                    | 无                       | 无决定控制。用于日志记录或清理等副作用                                                                                                                                  |

以下是每种模式的实际示例：

<Tabs>
  <Tab title="顶级决定">
    由 `UserPromptSubmit`、`UserPromptExpansion`、`PostToolUse`、`PostToolUseFailure`、`PostToolBatch`、`Stop`、`SubagentStop`、`ConfigChange` 和 `PreCompact` 使用。唯一的值是 `"block"`。要允许操作继续，从您的 JSON 中省略 `decision`，或退出 0 而不带任何 JSON：

    ```json theme={null}
    {
      "decision": "block",
      "reason": "Test suite must pass before proceeding"
    }
    ```
  </Tab>

  <Tab title="PreToolUse">
    使用 `hookSpecificOutput` 以获得更丰富的控制：允许、拒绝或升级给用户。您还可以在运行前修改工具输入或为 Claude 注入额外上下文。有关完整的选项集，请参阅[PreToolUse 决定控制](#pretooluse-decision-control)。

    ```json theme={null}
    {
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Database writes are not allowed"
      }
    }
    ```
  </Tab>

  <Tab title="PermissionRequest">
    使用 `hookSpecificOutput` 代表用户允许或拒绝权限请求。允许时，您还可以修改工具的输入或应用权限规则，以便用户不会再次被提示。有关完整的选项集，请参阅[PermissionRequest 决定控制](#permissionrequest-decision-control)。

    ```json theme={null}
    {
      "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision": {
          "behavior": "allow",
          "updatedInput": {
            "command": "npm run lint"
          }
        }
      }
    }
    ```
  </Tab>
</Tabs>

有关扩展示例，包括 Bash 命令验证、提示过滤和自动批准脚本，请参阅指南中的[您可以自动化的内容](/zh-CN/hooks-guide#what-you-can-automate)以及[Bash 命令验证器参考实现](https://github.com/anthropics/claude-code/blob/main/examples/hooks/bash_command_validator_example.py)。

## Hook 事件

每个事件对应于 Claude Code 生命周期中 hooks 可以运行的一个点。下面的部分按照生命周期排序：从会话设置通过代理循环到会话结束。每个部分描述事件何时触发、它支持的匹配器、它接收的 JSON 输入以及如何通过输出控制行为。

### SessionStart

在 Claude Code 启动新会话或恢复现有会话时运行。用于加载开发上下文，如现有问题或代码库的最近更改，或设置环境变量。对于不需要脚本的静态上下文，请改用[CLAUDE.md](/zh-CN/memory)。

SessionStart 在每个会话上运行，因此保持这些 hooks 快速。仅支持 `type: "command"` 和 `type: "mcp_tool"` hooks。

匹配器值对应于会话的启动方式：

| 匹配器       | 何时触发                                |
| :-------- | :---------------------------------- |
| `startup` | 新会话                                 |
| `resume`  | `--resume`、`--continue` 或 `/resume` |
| `clear`   | `/clear`                            |
| `compact` | 自动或手动压缩                             |

#### SessionStart 输入

除了[通用输入字段](#common-input-fields)外，SessionStart hooks 还接收 `source`、`model` 和可选的 `agent_type`。`source` 字段指示会话如何启动：新会话为 `"startup"`，恢复会话为 `"resume"`，`/clear` 后为 `"clear"`，压缩后为 `"compact"`。`model` 字段包含模型标识符。如果您使用 `claude --agent <name>` 启动 Claude Code，`agent_type` 字段包含代理名称。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6"
}
```

#### SessionStart 决定控制

您的 hook 脚本打印到 stdout 的任何文本都作为 Claude 的上下文添加。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您还可以返回这些事件特定字段：

| 字段                   | 描述                                                                                                                                |
| :------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `additionalContext`  | 添加到 Claude 上下文开始处的字符串，在第一个提示之前。请参阅[为 Claude 添加上下文](#add-context-for-claude)了解文本如何传递、放入什么内容以及恢复的会话如何处理过去的值                         |
| `initialUserMessage` | 用作会话第一个用户消息的字符串。适用于[非交互模式](/zh-CN/headless)（`-p`），其中即使未提供提示，它也成为第一个轮次。如果提供了提示，它作为下一个轮次跟随。与 `additionalContext` 不同，后者附加到现有轮次，这创建轮次 |
| `watchPaths`         | 绝对路径数组，用于在此会话期间监视[FileChanged](#filechanged)事件                                                                                    |

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth-refactor\nUncommitted changes: src/auth.ts, src/login.tsx\nActive issue: #4211 Migrate to OAuth2"
  }
}
```

由于纯 stdout 已经为此事件到达 Claude，仅加载上下文的 hook 可以直接打印到 stdout 而无需构建 JSON。当您需要将上下文与其他字段（如 `suppressOutput`）结合时，使用 JSON 形式。

#### 持久化环境变量

SessionStart hooks 可以访问 `CLAUDE_ENV_FILE` 环境变量，该变量提供一个文件路径，您可以在其中为后续 Bash 命令持久化环境变量。

要设置单个环境变量，请将 `export` 语句写入 `CLAUDE_ENV_FILE`。使用追加（`>>`）来保留由其他 hooks 设置的变量：

```bash theme={null}
#!/bin/bash

if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=production' >> "$CLAUDE_ENV_FILE"
  echo 'export DEBUG_LOG=true' >> "$CLAUDE_ENV_FILE"
  echo 'export PATH="$PATH:./node_modules/.bin"' >> "$CLAUDE_ENV_FILE"
fi

exit 0
```

要捕获设置命令中的所有环境更改，请比较之前和之后导出的变量：

```bash theme={null}
#!/bin/bash

ENV_BEFORE=$(export -p | sort)

# 运行修改环境的设置命令
source ~/.nvm/nvm.sh
nvm use 20

if [ -n "$CLAUDE_ENV_FILE" ]; then
  ENV_AFTER=$(export -p | sort)
  comm -13 <(echo "$ENV_BEFORE") <(echo "$ENV_AFTER") >> "$CLAUDE_ENV_FILE"
fi

exit 0
```

写入此文件的任何变量都将在会话期间 Claude Code 执行的所有后续 Bash 命令中可用。

<Note>
  `CLAUDE_ENV_FILE` 可用于 SessionStart、[Setup](#setup)、[CwdChanged](#cwdchanged) 和 [FileChanged](#filechanged) hooks。其他 hook 类型无法访问此变量。
</Note>

### Setup

仅当您使用 `--init-only` 启动 Claude Code，或在打印模式（`-p`）中使用 `--init` 或 `--maintenance` 时触发。它不在正常启动时触发。使用它进行一次性依赖安装或您从 CI 或脚本显式触发的计划清理，与正常会话启动分开。对于每个会话的初始化，请改用[SessionStart](#sessionstart)。

匹配器值对应于触发 hook 的 CLI 标志：

| 匹配器           | 何时触发                                      |
| :------------ | :---------------------------------------- |
| `init`        | `claude --init-only` 或 `claude -p --init` |
| `maintenance` | `claude -p --maintenance`                 |

`--init-only` 运行 Setup hooks 和 SessionStart hooks（带 `startup` 匹配器），然后退出而不启动对话。`--init` 和 `--maintenance` 仅在与 `-p`（打印模式）结合时触发 Setup hooks；在交互式会话中，这两个标志目前不触发 Setup hooks。

因为 Setup 不在每次启动时触发，需要安装依赖的插件不能仅依赖 Setup。实际的模式是在首次使用时检查依赖，如果缺失则安装，例如测试 `${CLAUDE_PLUGIN_DATA}/node_modules` 的 hook 或 skill，如果不存在则运行 `npm install`。请参阅[持久数据目录](/zh-CN/plugins-reference#persistent-data-directory)了解在何处存储已安装的依赖。

#### Setup 输入

除了[通用输入字段](#common-input-fields)外，Setup hooks 还接收一个 `trigger` 字段，设置为 `"init"` 或 `"maintenance"`：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "Setup",
  "trigger": "init"
}
```

#### Setup 决定控制

Setup hooks 无法阻止。退出代码 2 时，stderr 向用户显示；任何其他非零退出代码时，stderr 仅在您使用 `--verbose` 启动时出现。在两种情况下，执行都继续。要将信息传入 Claude 的上下文，在 JSON 输出中返回 `additionalContext`；纯 stdout 仅写入调试日志。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您还可以返回这些事件特定字段：

| 字段                  | 描述                                |
| :------------------ | :-------------------------------- |
| `additionalContext` | 添加到 Claude 上下文的字符串。多个 hooks 的值被连接 |

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "Setup",
    "additionalContext": "Dependencies installed: node_modules, .venv"
  }
}
```

Setup hooks 可以访问 `CLAUDE_ENV_FILE`。写入该文件的变量持久化到会话的后续 Bash 命令中，就像在[SessionStart hooks](#persist-environment-variables)中一样。仅支持 `type: "command"` 和 `type: "mcp_tool"` hooks。

### InstructionsLoaded

当 `CLAUDE.md` 或 `.claude/rules/*.md` 文件加载到上下文中时触发。此事件在会话启动时为急切加载的文件触发，稍后当文件被懒加载时再次触发，例如当 Claude 访问包含嵌套 `CLAUDE.md` 的子目录或条件规则与 `paths:` frontmatter 匹配时。该 hook 不支持阻止或决定控制。它异步运行以用于可观测性目的。

匹配器针对 `load_reason` 运行。例如，使用 `"matcher": "session_start"` 仅对会话启动时加载的文件触发，或使用 `"matcher": "path_glob_match|nested_traversal"` 仅对懒加载触发。

#### InstructionsLoaded 输入

除了[通用输入字段](#common-input-fields)外，InstructionsLoaded hooks 还接收这些字段：

| 字段                  | 描述                                                                                                                           |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `file_path`         | 加载的指令文件的绝对路径                                                                                                                 |
| `memory_type`       | 文件的范围：`"User"`、`"Project"`、`"Local"` 或 `"Managed"`                                                                           |
| `load_reason`       | 文件被加载的原因：`"session_start"`、`"nested_traversal"`、`"path_glob_match"`、`"include"` 或 `"compact"`。`"compact"` 值在压缩事件后重新加载指令文件时触发 |
| `globs`             | 文件 `paths:` frontmatter 中的路径 glob 模式（如果有）。仅对 `path_glob_match` 加载存在                                                          |
| `trigger_file_path` | 触发此加载的文件的路径，用于懒加载                                                                                                            |
| `parent_file_path`  | 包含此文件的父指令文件的路径，用于 `include` 加载                                                                                               |

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project",
  "hook_event_name": "InstructionsLoaded",
  "file_path": "/Users/my-project/CLAUDE.md",
  "memory_type": "Project",
  "load_reason": "session_start"
}
```

#### InstructionsLoaded 决定控制

InstructionsLoaded hooks 没有决定控制。它们无法阻止或修改指令加载。使用此事件进行审计日志记录、合规性跟踪或可观测性。

### UserPromptSubmit

在用户提交提示时运行，在 Claude 处理之前。这允许您根据提示/对话添加额外上下文、验证提示或阻止某些类型的提示。

`UserPromptSubmit` hooks 对 `command`、`http` 和 `mcp_tool` 类型的默认超时为 30 秒，比这些类型在其他事件上的 600 秒默认值更短。因为此 hook 在每个提示之前运行并阻止模型处理直到完成，卡住的 hook 会停滞会话。如果您的 hook 需要更多时间，在 hook 条目中设置 `timeout` 字段。

#### UserPromptSubmit 输入

除了[通用输入字段](#common-input-fields)外，UserPromptSubmit hooks 还接收包含用户提交的文本的 `prompt` 字段。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

#### UserPromptSubmit 决定控制

`UserPromptSubmit` hooks 可以控制用户提示是否被处理并添加上下文。所有[JSON 输出字段](#json-output)都可用。

有两种方法可以在退出代码 0 时向对话添加上下文：

* **纯文本 stdout**：写入 stdout 的任何非 JSON 文本都作为上下文添加
* **带 `additionalContext` 的 JSON**：使用下面的 JSON 格式以获得更多控制。`additionalContext` 字段作为上下文添加

纯 stdout 在成绩单中显示为 hook 输出。`additionalContext` 字段更谨慎地添加。

要阻止提示，返回一个 JSON 对象，其中 `decision` 设置为 `"block"`：

| 字段                       | 描述                                                                       |
| :----------------------- | :----------------------------------------------------------------------- |
| `decision`               | `"block"` 防止提示被处理并从上下文中删除。省略以允许提示继续                                      |
| `reason`                 | 当 `decision` 为 `"block"` 时向用户显示。不添加到上下文                                  |
| `additionalContext`      | 添加到 Claude 上下文的字符串，与提交的提示一起。请参阅[为 Claude 添加上下文](#add-context-for-claude) |
| `sessionTitle`           | 设置会话标题。使用此根据提示内容自动命名会话                                                   |
| `suppressOriginalPrompt` | 如果 `true` 当 `decision` 为 `"block"` 时，从向用户显示的阻止消息中省略原始提示文本                |

```json theme={null}
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here",
    "sessionTitle": "My session title"
  }
}
```

<Note>
  JSON 格式对于简单用例不是必需的。要添加上下文，您可以使用退出代码 0 将纯文本打印到 stdout。当您需要阻止提示或想要更结构化的控制时，使用 JSON。
</Note>

### UserPromptExpansion

当用户输入的斜杠命令在到达 Claude 之前展开为提示时运行。使用此来阻止特定命令的直接调用、为特定 skill 注入上下文或记录用户调用哪些命令。例如，匹配 `deploy` 的 hook 可以阻止 `/deploy`，除非存在批准文件，或匹配审查 skill 的 hook 可以将团队的审查清单附加为 `additionalContext`。

此事件涵盖 `PreToolUse` 不涵盖的路径：匹配 `Skill` 工具的 `PreToolUse` hook 仅在 Claude 调用工具时触发，但直接输入 `/skillname` 绕过 `PreToolUse`。`UserPromptExpansion` 在该直接路径上触发。

在 `command_name` 上匹配。留空匹配器以对每个提示类型斜杠命令触发。

#### UserPromptExpansion 输入

除了[通用输入字段](#common-input-fields)外，UserPromptExpansion hooks 还接收 `expansion_type`、`command_name`、`command_args`、`command_source` 和原始 `prompt` 字符串。`expansion_type` 字段对于 skill 和自定义命令为 `slash_command`，或对于 MCP 服务器提示为 `mcp_prompt`。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../00893aaf.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptExpansion",
  "expansion_type": "slash_command",
  "command_name": "example-skill",
  "command_args": "arg1 arg2",
  "command_source": "plugin",
  "prompt": "/example-skill arg1 arg2"
}
```

#### UserPromptExpansion 决定控制

`UserPromptExpansion` hooks 可以阻止展开或添加上下文。所有[JSON 输出字段](#json-output)都可用。

| 字段                  | 描述                                                                       |
| :------------------ | :----------------------------------------------------------------------- |
| `decision`          | `"block"` 防止斜杠命令展开。省略以允许它继续                                              |
| `reason`            | 当 `decision` 为 `"block"` 时向用户显示                                          |
| `additionalContext` | 添加到 Claude 上下文的字符串，与展开的提示一起。请参阅[为 Claude 添加上下文](#add-context-for-claude) |

```json theme={null}
{
  "decision": "block",
  "reason": "This slash command is not available",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptExpansion",
    "additionalContext": "Additional context for this expansion"
  }
}
```

### PreToolUse

在 Claude 创建工具参数后和处理工具调用之前运行。在工具名称上匹配：`Bash`、`Edit`、`Write`、`Read`、`Glob`、`Grep`、`Agent`、`WebFetch`、`WebSearch`、`AskUserQuestion`、`ExitPlanMode` 和任何[MCP 工具名称](#match-mcp-tools)。

使用[PreToolUse 决定控制](#pretooluse-decision-control)来允许、拒绝、询问或延迟工具调用。

#### PreToolUse 输入

除了[通用输入字段](#common-input-fields)外，PreToolUse hooks 还接收 `tool_name`、`tool_input` 和 `tool_use_id`。`tool_input` 字段取决于工具：

##### Bash

执行 shell 命令。

| 字段                  | 类型      | 示例                 | 描述            |
| :------------------ | :------ | :----------------- | :------------ |
| `command`           | string  | `"npm test"`       | 要执行的 shell 命令 |
| `description`       | string  | `"Run test suite"` | 命令执行操作的可选描述   |
| `timeout`           | number  | `120000`           | 可选超时（毫秒）      |
| `run_in_background` | boolean | `false`            | 是否在后台运行命令     |

##### Write

创建或覆盖文件。

| 字段          | 类型     | 示例                    | 描述          |
| :---------- | :----- | :-------------------- | :---------- |
| `file_path` | string | `"/path/to/file.txt"` | 要写入的文件的绝对路径 |
| `content`   | string | `"file content"`      | 要写入文件的内容    |

##### Edit

替换现有文件中的字符串。

| 字段            | 类型      | 示例                    | 描述          |
| :------------ | :------ | :-------------------- | :---------- |
| `file_path`   | string  | `"/path/to/file.txt"` | 要编辑的文件的绝对路径 |
| `old_string`  | string  | `"original text"`     | 要查找和替换的文本   |
| `new_string`  | string  | `"replacement text"`  | 替换文本        |
| `replace_all` | boolean | `false`               | 是否替换所有出现    |

##### Read

读取文件内容。

| 字段          | 类型     | 示例                    | 描述          |
| :---------- | :----- | :-------------------- | :---------- |
| `file_path` | string | `"/path/to/file.txt"` | 要读取的文件的绝对路径 |
| `offset`    | number | `10`                  | 可选的开始读取的行号  |
| `limit`     | number | `50`                  | 可选的要读取的行数   |

##### Glob

查找与 glob 模式匹配的文件。

| 字段        | 类型     | 示例               | 描述                |
| :-------- | :----- | :--------------- | :---------------- |
| `pattern` | string | `"**/*.ts"`      | 要匹配文件的 Glob 模式    |
| `path`    | string | `"/path/to/dir"` | 可选的搜索目录。默认为当前工作目录 |

##### Grep

使用正则表达式搜索文件内容。

| 字段            | 类型      | 示例               | 描述                                                                        |
| :------------ | :------ | :--------------- | :------------------------------------------------------------------------ |
| `pattern`     | string  | `"TODO.*fix"`    | 要搜索的正则表达式模式                                                               |
| `path`        | string  | `"/path/to/dir"` | 可选的要搜索的文件或目录                                                              |
| `glob`        | string  | `"*.ts"`         | 可选的 glob 模式以过滤文件                                                          |
| `output_mode` | string  | `"content"`      | `"content"`、`"files_with_matches"` 或 `"count"`。默认为 `"files_with_matches"` |
| `-i`          | boolean | `true`           | 不区分大小写的搜索                                                                 |
| `multiline`   | boolean | `false`          | 启用多行匹配                                                                    |

##### WebFetch

获取和处理 web 内容。

| 字段       | 类型     | 示例                            | 描述           |
| :------- | :----- | :---------------------------- | :----------- |
| `url`    | string | `"https://example.com/api"`   | 要获取内容的 URL   |
| `prompt` | string | `"Extract the API endpoints"` | 在获取的内容上运行的提示 |

##### WebSearch

搜索网络。

| 字段                | 类型     | 示例                             | 描述             |
| :---------------- | :----- | :----------------------------- | :------------- |
| `query`           | string | `"react hooks best practices"` | 搜索查询           |
| `allowed_domains` | array  | `["docs.example.com"]`         | 可选：仅包含来自这些域的结果 |
| `blocked_domains` | array  | `["spam.example.com"]`         | 可选：排除来自这些域的结果  |

##### Agent

生成一个[subagent](/zh-CN/sub-agents)。

| 字段              | 类型     | 示例                         | 描述            |
| :-------------- | :----- | :------------------------- | :------------ |
| `prompt`        | string | `"Find all API endpoints"` | 代理要执行的任务      |
| `description`   | string | `"Find API endpoints"`     | 任务的简短描述       |
| `subagent_type` | string | `"Explore"`                | 要使用的专门代理的类型   |
| `model`         | string | `"sonnet"`                 | 可选的模型别名以覆盖默认值 |

在 `PostToolUse` 中，已完成的 Agent 调用的 `tool_response` 携带 subagent 的最终文本以及使用遥测。读取这些字段以从 hook 记录每个 subagent 的成本：

| 字段                  | 类型     | 示例                                                    | 描述                                                                                              |
| :------------------ | :----- | :---------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| `status`            | string | `"completed"`                                         | 同步调用为 `"completed"`，`run_in_background: true` 为 `"async_launched"`                              |
| `agentId`           | string | `"a4d2c8f1e0b3a297"`                                  | subagent 运行的标识符                                                                                 |
| `content`           | array  | `[{"type": "text", "text": "Found 12 endpoints..."}]` | subagent 的最终文本块                                                                                 |
| `totalTokens`       | number | `12450`                                               | 在 subagent 轮次中计费的总令牌数                                                                           |
| `totalDurationMs`   | number | `48211`                                               | subagent 运行的挂钟时间                                                                                |
| `totalToolUseCount` | number | `7`                                                   | subagent 进行的工具调用计数                                                                              |
| `usage`             | object | `{"input_tokens": 8320, ...}`                         | 按类型的令牌分解：`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens` |

对于 `run_in_background: true` 调用，工具在启动 subagent 后立即返回，因此 `tool_response` 不携带使用字段。它具有 `status: "async_launched"`、`agentId`、`description`、`prompt` 和 `outputFile`。

##### AskUserQuestion

向用户提出一到四个多选题。

| 字段          | 类型     | 示例                                                                                                                 | 描述                                                                         |
| :---------- | :----- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `questions` | array  | `[{"question": "Which framework?", "header": "Framework", "options": [{"label": "React"}], "multiSelect": false}]` | 要呈现的问题，每个都有 `question` 字符串、短 `header`、`options` 数组和可选的 `multiSelect` 标志    |
| `answers`   | object | `{"Which framework?": "React"}`                                                                                    | 可选。将问题文本映射到选定的选项标签。多选答案用逗号连接标签。Claude 不设置此字段；通过 `updatedInput` 提供它以以编程方式回答 |

##### ExitPlanMode

呈现一个计划并要求用户在 Claude 离开[Plan Mode](/zh-CN/permission-modes#analyze-before-you-edit-with-plan-mode)之前批准它。Claude 在调用工具之前将计划写入磁盘上的文件，因此来自模型的字面 `tool_input` 仅携带 `allowedPrompts`。Claude Code 在将输入传递给 hooks 之前注入计划内容和文件路径。

| 字段               | 类型     | 示例                                          | 描述                                                       |
| :--------------- | :----- | :------------------------------------------ | :------------------------------------------------------- |
| `plan`           | string | `"## Refactor auth\n1. Extract..."`         | Markdown 中的计划内容。从磁盘上的计划文件注入                              |
| `planFilePath`   | string | `"/Users/.../plans/refactor-auth.md"`       | 计划文件的路径。注入                                               |
| `allowedPrompts` | array  | `[{"tool": "Bash", "prompt": "run tests"}]` | 可选。Claude 请求实现计划的基于提示的权限，每个都有 `tool` 名称和描述操作类别的 `prompt` |

在 `PostToolUse` 中，`tool_response` 是一个对象，具有 `plan` 和 `filePath` 字段，保存批准的计划，加上内部状态标志。读取 `tool_response.plan` 以获取计划内容，而不是从磁盘重新读取文件。

#### PreToolUse 决定控制

`PreToolUse` hooks 可以控制工具调用是否继续。与使用顶级 `decision` 字段的其他 hooks 不同，PreToolUse 在 `hookSpecificOutput` 对象内返回其决定。这给了它更丰富的控制：四个结果（允许、拒绝、询问或延迟）加上在执行前修改工具输入的能力。

| 字段                         | 描述                                                                                                                                           |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissionDecision`       | `"allow"` 绕过权限提示。`"deny"` 防止工具调用。`"ask"` 提示用户确认。`"defer"` 优雅地退出，以便工具稍后可以恢复。[拒绝和询问规则](/zh-CN/permissions#manage-permissions)在 hook 返回什么时仍然被评估 |
| `permissionDecisionReason` | 对于 `"allow"` 和 `"ask"`，向用户显示但不向 Claude 显示。对于 `"deny"`，向 Claude 显示。对于 `"defer"`，被忽略                                                           |
| `updatedInput`             | 在执行前修改工具的输入参数。替换整个输入对象，因此包括未修改的字段以及修改后的字段。与 `"allow"` 结合以自动批准，或与 `"ask"` 结合以向用户显示修改后的输入。对于 `"defer"`，被忽略                                     |
| `additionalContext`        | 在工具执行前添加到 Claude 上下文的字符串。对于 `"defer"`，被忽略。请参阅[为 Claude 添加上下文](#add-context-for-claude)                                                       |

当多个 PreToolUse hooks 返回不同的决定时，优先级是 `deny` > `defer` > `ask` > `allow`。

当 hook 返回 `"ask"` 时，向用户显示的权限提示包括一个标签，标识 hook 来自何处：例如，`[User]`、`[Project]`、`[Plugin]` 或 `[Local]`。这帮助用户了解哪个配置源正在请求确认。

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": {
      "field_to_modify": "new value"
    },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```

`AskUserQuestion` 和 `ExitPlanMode` 需要用户交互，通常在[非交互模式](/zh-CN/headless)中使用 `-p` 标志时阻止。返回 `permissionDecision: "allow"` 以及 `updatedInput` 满足该要求：hook 从 stdin 读取工具的输入，通过您自己的 UI 收集答案，并在 `updatedInput` 中返回它，以便工具运行而不提示。仅返回 `"allow"` 对这些工具不足够。对于 `AskUserQuestion`，回显原始 `questions` 数组并添加一个[`answers`](#askuserquestion)对象，将每个问题的文本映射到选定的答案。

<Note>
  PreToolUse 之前使用顶级 `decision` 和 `reason` 字段，但这些对此事件已弃用。改用 `hookSpecificOutput.permissionDecision` 和 `hookSpecificOutput.permissionDecisionReason`。已弃用的值 `"approve"` 和 `"block"` 映射到 `"allow"` 和 `"deny"`。PostToolUse 和 Stop 等其他事件继续使用顶级 `decision` 和 `reason` 作为其当前格式。
</Note>

#### 延迟工具调用以供稍后使用

`"defer"` 用于运行 `claude -p` 作为子进程并读取其 JSON 输出的集成，例如 Agent SDK 应用或构建在 Claude Code 之上的自定义 UI。它让该调用进程在工具调用处暂停 Claude，通过其自己的界面收集输入，并从中断处恢复。Claude Code 仅在[非交互模式](/zh-CN/headless)中使用 `-p` 标志时遵守此值。在交互式会话中，它记录警告并忽略 hook 结果。

<Note>
  `defer` 值需要 Claude Code v2.1.89 或更高版本。早期版本不识别它，工具通过正常权限流程进行。
</Note>

`AskUserQuestion` 工具是典型情况：Claude 想要询问用户一些事情，但没有终端来回答。往返工作如下：

1. Claude 调用 `AskUserQuestion`。`PreToolUse` hook 触发。
2. Hook 返回 `permissionDecision: "defer"`。工具不执行。进程以 `stop_reason: "tool_deferred"` 退出，待处理的工具调用保留在成绩单中。
3. 调用进程从 SDK 结果读取 `deferred_tool_use`，在其自己的 UI 中显示问题，并等待答案。
4. 调用进程运行 `claude -p --resume <session-id>`。相同的工具调用再次触发 `PreToolUse`。
5. Hook 返回 `permissionDecision: "allow"` 和 `updatedInput` 中的答案。工具执行，Claude 继续。

`deferred_tool_use` 字段携带工具的 `id`、`name` 和 `input`。`input` 是 Claude 为工具调用生成的参数，在执行前捕获：

```json theme={null}
{
  "type": "result",
  "subtype": "success",
  "stop_reason": "tool_deferred",
  "session_id": "abc123",
  "deferred_tool_use": {
    "id": "toolu_01abc",
    "name": "AskUserQuestion",
    "input": { "questions": [{ "question": "Which framework?", "header": "Framework", "options": [{"label": "React"}, {"label": "Vue"}], "multiSelect": false }] }
  }
}
```

没有超时或重试限制。会话保留在磁盘上，直到您恢复它，受到 [`cleanupPeriodDays`](/zh-CN/settings#available-settings) 保留扫描的约束，该扫描默认在 30 天后删除会话文件。如果恢复时答案还没有准备好，hook 可以再次返回 `"defer"`，进程以相同的方式退出。调用进程控制何时通过最终返回 `"allow"` 或 `"deny"` 从 hook 中断循环。

`"defer"` 仅在 Claude 在轮次中进行单个工具调用时有效。如果 Claude 一次进行多个工具调用，`"defer"` 被忽略并显示警告，工具通过正常权限流程进行。约束存在是因为恢复只能重新运行一个工具：没有办法延迟一个调用而不留下其他调用未解决。

如果恢复时延迟的工具不再可用，进程以 `stop_reason: "tool_deferred_unavailable"` 和 `is_error: true` 退出，在 hook 触发之前。这发生在为恢复的会话未连接提供工具的 MCP 服务器时。`deferred_tool_use` 有效负载仍然包括，以便您可以识别哪个工具丢失。

<Note>
  `--resume` 恢复工具被延迟时活跃的权限模式，因此您不需要再次传递 `--permission-mode`。例外是 `plan` 和 `bypassPermissions`，它们永远不会被携带。在恢复时显式传递 `--permission-mode` 会覆盖恢复的值。
</Note>

### PermissionRequest

在向用户显示权限对话框时运行。使用[PermissionRequest 决定控制](#permissionrequest-decision-control)代表用户允许或拒绝。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PermissionRequest 输入

PermissionRequest hooks 接收 `tool_name` 和 `tool_input` 字段，如 PreToolUse hooks，但没有 `tool_use_id`。可选的 `permission_suggestions` 数组包含用户通常在权限对话框中看到的"总是允许"选项。区别在于 hook 何时触发：PermissionRequest hooks 在权限对话框即将显示给用户时运行，而 PreToolUse hooks 在工具执行前运行，无论权限状态如何。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules",
    "description": "Remove node_modules directory"
  },
  "permission_suggestions": [
    {
      "type": "addRules",
      "rules": [{ "toolName": "Bash", "ruleContent": "rm -rf node_modules" }],
      "behavior": "allow",
      "destination": "localSettings"
    }
  ]
}
```

#### PermissionRequest 决定控制

`PermissionRequest` hooks 可以允许或拒绝权限请求。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回一个 `decision` 对象，其中包含这些事件特定字段：

| 字段                   | 描述                                                                                                                  |
| :------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `behavior`           | `"allow"` 授予权限，`"deny"` 拒绝它。[拒绝和询问规则](/zh-CN/permissions#manage-permissions)仍然被评估，所以返回 `"allow"` 的 hook 不会覆盖匹配的拒绝规则 |
| `updatedInput`       | 仅对 `"allow"`：在执行前修改工具的输入参数。替换整个输入对象，因此包括未修改的字段以及修改后的字段。修改后的输入会重新针对拒绝和询问规则进行评估                                       |
| `updatedPermissions` | 仅对 `"allow"`：应用权限规则更新的[权限更新条目](#permission-update-entries)数组，例如添加允许规则或更改会话权限模式                                      |
| `message`            | 仅对 `"deny"`：告诉 Claude 为什么权限被拒绝                                                                                      |
| `interrupt`          | 仅对 `"deny"`：如果为 `true`，停止 Claude                                                                                    |

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": {
        "command": "npm run lint"
      }
    }
  }
}
```

#### 权限更新条目

`updatedPermissions` 输出字段和[`permission_suggestions` 输入字段](#permissionrequest-input)都使用相同的条目对象数组。每个条目都有一个 `type` 来确定其其他字段，以及一个 `destination` 来控制更改的写入位置。

| `type`              | 字段                               | 效果                                                                                                                   |
| :------------------ | :------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `addRules`          | `rules`、`behavior`、`destination` | 添加权限规则。`rules` 是 `{toolName, ruleContent?}` 对象的数组。省略 `ruleContent` 以匹配整个工具。`behavior` 是 `"allow"`、`"deny"` 或 `"ask"` |
| `replaceRules`      | `rules`、`behavior`、`destination` | 用提供的 `rules` 替换 `destination` 处给定 `behavior` 的所有规则                                                                   |
| `removeRules`       | `rules`、`behavior`、`destination` | 移除给定 `behavior` 的匹配规则                                                                                                |
| `setMode`           | `mode`、`destination`             | 更改权限模式。有效模式为 `default`、`auto`、`acceptEdits`、`dontAsk`、`bypassPermissions` 和 `plan`                                   |
| `addDirectories`    | `directories`、`destination`      | 添加工作目录。`directories` 是路径字符串的数组                                                                                       |
| `removeDirectories` | `directories`、`destination`      | 移除工作目录                                                                                                               |

<Note>
  `setMode` 与 `bypassPermissions` 仅在会话已启动时生效，绕过模式已可用：`--dangerously-skip-permissions`、`--permission-mode bypassPermissions`、`--allow-dangerously-skip-permissions` 或设置中的 `permissions.defaultMode: "bypassPermissions"`，且模式未被 [`permissions.disableBypassPermissionsMode`](/zh-CN/permissions#managed-settings) 禁用。否则更新是无操作。`bypassPermissions` 无论 `destination` 如何都永远不会作为 `defaultMode` 持久化。
</Note>

每个条目上的 `destination` 字段确定更改是保留在内存中还是持久化到设置文件。

| `destination`     | 写入                            |
| :---------------- | :---------------------------- |
| `session`         | 仅在内存中，会话结束时丢弃                 |
| `localSettings`   | `.claude/settings.local.json` |
| `projectSettings` | `.claude/settings.json`       |
| `userSettings`    | `~/.claude/settings.json`     |

Hook 可以回显它接收的 `permission_suggestions` 之一作为其自己的 `updatedPermissions` 输出，这等同于用户在对话框中选择该"总是允许"选项。

### PostToolUse

在工具成功完成后立即运行。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PostToolUse 输入

`PostToolUse` hooks 在工具已经成功执行后触发。输入包括 `tool_input`（发送给工具的参数）和 `tool_response`（它返回的结果）。两者的确切架构取决于工具。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "success": true
  },
  "tool_use_id": "toolu_01ABC123...",
  "duration_ms": 12
}
```

| 字段            | 描述                                             |
| :------------ | :--------------------------------------------- |
| `duration_ms` | 可选。工具执行时间（毫秒）。不包括权限提示和 PreToolUse hooks 中花费的时间 |

#### PostToolUse 决定控制

`PostToolUse` hooks 可以在工具执行后向 Claude 提供反馈。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段                     | 描述                                                                         |
| :--------------------- | :------------------------------------------------------------------------- |
| `decision`             | `"block"` 用 `reason` 提示 Claude。Claude 仍然看到原始输出；要替换它，使用 `updatedToolOutput` |
| `reason`               | 当 `decision` 为 `"block"` 时向 Claude 显示的解释                                   |
| `additionalContext`    | 添加到 Claude 上下文的字符串，与工具结果一起。请参阅[为 Claude 添加上下文](#add-context-for-claude)    |
| `updatedToolOutput`    | 用提供的值替换工具的输出，然后将其发送给 Claude。该值必须与工具的输出形状匹配                                 |
| `updatedMCPToolOutput` | 仅对[MCP 工具](#match-mcp-tools)替换输出。优先使用 `updatedToolOutput`，它适用于所有工具         |

下面的示例替换 `Bash` 调用的输出。替换值与 `Bash` 工具的输出形状匹配：

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Additional information for Claude",
    "updatedToolOutput": {
      "stdout": "[redacted]",
      "stderr": "",
      "interrupted": false,
      "isImage": false
    }
  }
}
```

<Warning>
  `updatedToolOutput` 仅改变 Claude 看到的内容。工具已经在 hook 触发时运行，所以任何写入的文件、执行的命令或发送的网络请求都已生效。遥测，如 OpenTelemetry 工具跨度和分析事件，也在 hook 运行前捕获原始输出。要在运行前防止或修改工具调用，请改用[PreToolUse](#pretooluse) hook。

  替换值必须与工具的输出形状匹配。内置工具返回结构化对象而不是纯字符串。例如，`Bash` 返回一个具有 `stdout`、`stderr`、`interrupted` 和 `isImage` 字段的对象。对于内置工具，不与工具的输出架构匹配的值被忽略，使用原始输出。MCP 工具输出通过而不进行架构验证。剥离 Claude 需要的错误详细信息可能导致它基于错误的假设继续。
</Warning>

### PostToolUseFailure

当工具执行失败时运行。此事件对于抛出错误或返回失败结果的工具调用触发。使用此来记录失败、发送警报或向 Claude 提供纠正反馈。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PostToolUseFailure 输入

PostToolUseFailure hooks 接收与 PostToolUse 相同的 `tool_name` 和 `tool_input` 字段，以及作为顶级字段的错误信息：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite"
  },
  "tool_use_id": "toolu_01ABC123...",
  "error": "Command exited with non-zero status code 1",
  "is_interrupt": false,
  "duration_ms": 4187
}
```

| 字段             | 描述                                             |
| :------------- | :--------------------------------------------- |
| `error`        | 描述出错原因的字符串                                     |
| `is_interrupt` | 可选的布尔值，指示失败是否由用户中断引起                           |
| `duration_ms`  | 可选。工具执行时间（毫秒）。不包括权限提示和 PreToolUse hooks 中花费的时间 |

#### PostToolUseFailure 决定控制

`PostToolUseFailure` hooks 可以在工具失败后向 Claude 提供上下文。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段                  | 描述                                                                    |
| :------------------ | :-------------------------------------------------------------------- |
| `additionalContext` | 添加到 Claude 上下文的字符串，与错误一起。请参阅[为 Claude 添加上下文](#add-context-for-claude) |

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": "Additional information about the failure for Claude"
  }
}
```

### PostToolBatch

在批次中的每个工具调用都已解决后运行一次，在 Claude Code 向模型发送下一个请求之前。`PostToolUse` 每个工具触发一次，这意味着当 Claude 进行并行工具调用时它并发触发。`PostToolBatch` 恰好触发一次，包含完整批次，因此它是注入取决于运行的工具集而不是任何单个工具的上下文的正确位置。此事件没有匹配器。

#### PostToolBatch 输入

除了[通用输入字段](#common-input-fields)外，PostToolBatch hooks 还接收 `tool_calls`，一个描述批次中每个工具调用的数组：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolBatch",
  "tool_calls": [
    {
      "tool_name": "Read",
      "tool_input": {"file_path": "/.../ledger/accounts.py"},
      "tool_use_id": "toolu_01...",
      "tool_response": "     1\tfrom __future__ import annotations\n     2\t..."
    },
    {
      "tool_name": "Read",
      "tool_input": {"file_path": "/.../ledger/transactions.py"},
      "tool_use_id": "toolu_02...",
      "tool_response": "     1\tfrom __future__ import annotations\n     2\t..."
    }
  ]
}
```

`tool_response` 包含与模型在相应 `tool_result` 块中接收的内容相同的内容。该值是序列化的字符串或内容块数组，完全如工具发出的那样。对于 `Read`，这意味着行号前缀的文本而不是原始文件内容。响应可能很大，因此仅解析您需要的字段。

<Note>
  `tool_response` 形状与 `PostToolUse` 的不同。`PostToolUse` 传递工具的结构化 `Output` 对象，例如 `{filePath: "...", success: true}` 对于 `Write`；`PostToolBatch` 传递序列化的 `tool_result` 内容模型看到的。
</Note>

#### PostToolBatch 决定控制

`PostToolBatch` hooks 可以为 Claude 注入上下文。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段                  | 描述                                                                                           |
| :------------------ | :------------------------------------------------------------------------------------------- |
| `additionalContext` | 在下一个模型调用之前注入的上下文字符串。请参阅[为 Claude 添加上下文](#add-context-for-claude)了解传递详情、放入什么内容以及恢复的会话如何处理过去的值 |

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolBatch",
    "additionalContext": "These files are part of the ledger module. Run pytest before marking the task complete."
  }
}
```

返回 `decision: "block"` 或 `continue: false` 在下一个模型调用之前停止代理循环。

### PermissionDenied

当[自动模式](/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)分类器拒绝工具调用时运行。此 hook 仅在自动模式中触发：当您手动拒绝权限对话框、`PreToolUse` hook 阻止调用或 `deny` 规则匹配时，它不运行。使用它来记录分类器拒绝、调整配置或告诉模型它可能重试工具调用。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PermissionDenied 输入

除了[通用输入字段](#common-input-fields)外，PermissionDenied hooks 还接收 `tool_name`、`tool_input`、`tool_use_id` 和 `reason`。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "auto",
  "hook_event_name": "PermissionDenied",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/build",
    "description": "Clean build directory"
  },
  "tool_use_id": "toolu_01ABC123...",
  "reason": "Auto mode denied: command targets a path outside the project"
}
```

| 字段       | 描述                 |
| :------- | :----------------- |
| `reason` | 分类器解释为什么工具调用被拒绝的原因 |

#### PermissionDenied 决定控制

PermissionDenied hooks 可以告诉模型它可能重试被拒绝的工具调用。返回一个 JSON 对象，其中 `hookSpecificOutput.retry` 设置为 `true`：

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionDenied",
    "retry": true
  }
}
```

当 `retry` 为 `true` 时，Claude Code 向对话添加一条消息，告诉模型它可能重试工具调用。拒绝本身不被反转。如果您的 hook 不返回 JSON，或返回 `retry: false`，拒绝成立，模型接收原始拒绝消息。

### Notification

在 Claude Code 发送通知时运行。在通知类型上匹配：`permission_prompt`、`idle_prompt`、`auth_success`、`elicitation_dialog`、`elicitation_complete`、`elicitation_response`。省略匹配器以为所有通知类型运行 hooks。

使用单独的匹配器根据通知类型运行不同的处理程序。此配置在 Claude 需要权限批准时触发权限特定的警报脚本，在 Claude 空闲时触发不同的通知：

```json theme={null}
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/permission-alert.sh"
          }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/idle-notification.sh"
          }
        ]
      }
    ]
  }
}
```

#### Notification 输入

除了[通用输入字段](#common-input-fields)外，Notification hooks 还接收 `message` 和通知文本、可选的 `title` 和 `notification_type` 指示哪个类型触发。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission",
  "title": "Permission needed",
  "notification_type": "permission_prompt"
}
```

Notification hooks 无法阻止或修改通知。它们用于副作用，例如将通知转发到外部服务。[通用 JSON 输出字段](#json-output)如 `systemMessage` 适用。

### SubagentStart

当通过 Agent 工具生成 Claude Code subagent 时运行。支持匹配器以按代理类型名称过滤。对于内置代理，这是代理名称，如 `general-purpose`、`Explore` 或 `Plan`。对于[自定义 subagents](/zh-CN/sub-agents)，这是代理 frontmatter 中的 `name` 字段，而不是文件名。

#### SubagentStart 输入

除了[通用输入字段](#common-input-fields)外，SubagentStart hooks 还接收 `agent_id` 和 subagent 的唯一标识符以及 `agent_type` 和代理名称（内置代理如 `"general-purpose"`、`"Explore"`、`"Plan"` 或自定义代理名称）。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SubagentStart",
  "agent_id": "agent-abc123",
  "agent_type": "Explore"
}
```

SubagentStart hooks 无法阻止 subagent 创建，但它们可以向 subagent 注入上下文。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您可以返回：

| 字段                  | 描述                                                                             |
| :------------------ | :----------------------------------------------------------------------------- |
| `additionalContext` | 添加到 subagent 上下文开始处的字符串，在其第一个提示之前。请参阅[为 Claude 添加上下文](#add-context-for-claude) |

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Follow security guidelines for this task"
  }
}
```

### SubagentStop

当 Claude Code subagent 完成响应时运行。在代理类型上匹配，与 SubagentStart 相同的值。

#### SubagentStop 输入

除了[通用输入字段](#common-input-fields)外，SubagentStop hooks 还接收 `stop_hook_active`、`agent_id`、`agent_type`、`agent_transcript_path` 和 `last_assistant_message`。`agent_type` 字段是用于匹配器过滤的值。`transcript_path` 是主会话的成绩单，而 `agent_transcript_path` 是 subagent 自己的成绩单，存储在嵌套的 `subagents/` 文件夹中。`last_assistant_message` 字段包含 subagent 最终响应的文本内容，因此 hooks 可以访问它而无需解析成绩单文件。

SubagentStop hooks 还接收 [Stop input](#stop-input) 中描述的 `background_tasks` 和 `session_crons` 数组，在 Claude Code v2.1.145 或更高版本中可用。两个数组都限定于父会话，而不是 subagent。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../abc123.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_type": "Explore",
  "agent_transcript_path": "~/.claude/projects/.../abc123/subagents/agent-def456.jsonl",
  "last_assistant_message": "Analysis complete. Found 3 potential issues...",
  "background_tasks": [],
  "session_crons": []
}
```

SubagentStop hooks 使用与[Stop hooks](#stop-decision-control)相同的决定控制格式。它们不支持 `additionalContext`。返回 `decision: "block"` 和 `reason` 保持 subagent 运行并将 `reason` 作为其下一个指令传递给 subagent。要在 subagent 返回后向父会话注入上下文，请改用 `Agent` 工具上的[`PostToolUse`](#posttooluse) hook。

### TaskCreated

当通过 `TaskCreate` 工具创建任务时运行。使用此来强制执行命名约定、要求任务描述或防止创建某些任务。

当 `TaskCreated` hook 以代码 2 退出时，任务不被创建，stderr 消息作为反馈反馈给模型。要完全停止队友而不是重新运行它，返回 JSON `{"continue": false, "stopReason": "..."}` 。TaskCreated hooks 不支持匹配器，在每次出现时触发。

#### TaskCreated 输入

除了[通用输入字段](#common-input-fields)外，TaskCreated hooks 还接收 `task_id`、`task_subject` 和可选的 `task_description`、`teammate_name` 和 `team_name`。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TaskCreated",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

| 字段                 | 描述               |
| :----------------- | :--------------- |
| `task_id`          | 被创建的任务的标识符       |
| `task_subject`     | 任务的标题            |
| `task_description` | 任务的详细描述。可能不存在    |
| `teammate_name`    | 创建任务的队友的名称。可能不存在 |
| `team_name`        | 团队的名称。可能不存在      |

#### TaskCreated 决定控制

TaskCreated hooks 支持两种方式来控制任务创建：

* **退出代码 2**：任务不被创建，stderr 消息作为反馈反馈给模型。
* **JSON `{"continue": false, "stopReason": "..."}`**：完全停止队友，匹配 `Stop` hook 行为。`stopReason` 向用户显示。

此示例阻止主题不遵循所需格式的任务：

```bash theme={null}
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

if [[ ! "$TASK_SUBJECT" =~ ^\[TICKET-[0-9]+\] ]]; then
  echo "Task subject must start with a ticket number, e.g. '[TICKET-123] Add feature'" >&2
  exit 2
fi

exit 0
```

### TaskCompleted

当任务被标记为已完成时运行。这在两种情况下触发：当任何代理通过 TaskUpdate 工具显式标记任务为已完成时，或当[代理团队](/zh-CN/agent-teams)队友完成其轮次且有进行中的任务时。使用此来强制执行完成标准，如通过测试或 lint 检查，然后任务才能关闭。

当 `TaskCompleted` hook 以代码 2 退出时，任务不被标记为已完成，stderr 消息作为反馈反馈给模型。要完全停止队友而不是重新运行它，返回 JSON `{"continue": false, "stopReason": "..."}` 。TaskCompleted hooks 不支持匹配器，在每次出现时触发。

#### TaskCompleted 输入

除了[通用输入字段](#common-input-fields)外，TaskCompleted hooks 还接收 `task_id`、`task_subject` 和可选的 `task_description`、`teammate_name` 和 `team_name`。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TaskCompleted",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

| 字段                 | 描述               |
| :----------------- | :--------------- |
| `task_id`          | 被完成的任务的标识符       |
| `task_subject`     | 任务的标题            |
| `task_description` | 任务的详细描述。可能不存在    |
| `teammate_name`    | 完成任务的队友的名称。可能不存在 |
| `team_name`        | 团队的名称。可能不存在      |

#### TaskCompleted 决定控制

TaskCompleted hooks 支持两种方式来控制任务完成：

* **退出代码 2**：任务不被标记为已完成，stderr 消息作为反馈反馈给模型。
* **JSON `{"continue": false, "stopReason": "..."}`**：完全停止队友，匹配 `Stop` hook 行为。`stopReason` 向用户显示。

此示例运行测试并在失败时阻止任务完成：

```bash theme={null}
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

# 运行测试套件
if ! npm test 2>&1; then
  echo "Tests not passing. Fix failing tests before completing: $TASK_SUBJECT" >&2
  exit 2
fi

exit 0
```

### Stop

在主 Claude Code 代理完成响应时运行。如果停止是由于用户中断，则不运行。API 错误触发[StopFailure](#stopfailure)。

<Tip>
  [`/goal`](/zh-CN/goal)命令是会话范围的基于提示的 Stop hook 的内置快捷方式。当您想要 Claude 继续工作直到条件成立而不编写 hook 配置时使用它。
</Tip>

#### Stop 输入

除了[通用输入字段](#common-input-fields)外，Stop hooks 还接收 `stop_hook_active`、`last_assistant_message`、`background_tasks` 和 `session_crons`。`stop_hook_active` 字段在 Claude Code 已经作为 stop hook 的结果继续时为 `true`。检查此值或处理成绩单以防止 Claude Code 无限运行。`last_assistant_message` 字段包含 Claude 最终响应的文本内容，因此 hooks 可以访问它而无需解析成绩单文件。

`background_tasks` 和 `session_crons` 数组在 Claude Code v2.1.145 或更高版本中可用，让 hooks 区分"会话完成"和"会话暂停等待后台工作唤醒它"。当任务注册表可达时两个数组都存在，当没有任何内容在进行中或计划时为空。

`background_tasks` 中的每个条目描述一个进行中的任务，并使用这些字段：

| 字段            | 描述                                                                                                                                         |
| :------------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | 任务标识符                                                                                                                                      |
| `type`        | 友好的任务类型标签，如 `shell`、`subagent`、`monitor`、`workflow`、`teammate`、`cloud session` 或 `MCP task`。每个标签标识哪个 Claude Code 功能创建了任务。对于无法识别的类型回退到原始判别式 |
| `status`      | 当前任务状态                                                                                                                                     |
| `description` | 自由文本描述，上限为 1000 个字符，当被剪切时在字符串中有 `… [+N chars]` 标记                                                                                          |
| `command`     | Shell 命令行，上限为 1000 个字符。仅对 `shell` 任务存在                                                                                                     |
| `agent_type`  | Subagent 类型名称。仅对 `subagent` 任务存在                                                                                                           |
| `server`      | MCP 服务器名称。仅对 `monitor` 和 `MCP task` 任务存在                                                                                                   |
| `tool`        | MCP 工具名称。仅对 `monitor` 和 `MCP task` 任务存在                                                                                                    |
| `name`        | 工作流名称。仅对 `workflow` 任务存在                                                                                                                   |

`session_crons` 中的每个条目描述一个会话范围的计划唤醒，来自 `CronCreate`、`ScheduleWakeup` 和 `/loop`：

| 字段          | 描述                                                   |
| :---------- | :--------------------------------------------------- |
| `id`        | Cron 任务标识符                                           |
| `schedule`  | Cron 表达式，例如 `0 9 * * 1-5`                            |
| `recurring` | `false` 用于一次性唤醒，其计划编码单个触发时间，`true` 用于在每次匹配时重新触发的任务   |
| `prompt`    | 当 cron 触发时提交的提示，上限为 1000 个字符，具有相同的 `… [+N chars]` 标记 |

此示例显示一个 Stop 输入，其中有一个进行中的 shell 任务和一个循环 cron：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": true,
  "last_assistant_message": "I've completed the refactoring. Here's a summary...",
  "background_tasks": [
    {
      "id": "task-001",
      "type": "shell",
      "status": "running",
      "description": "tail logs",
      "command": "tail -f /var/log/syslog"
    }
  ],
  "session_crons": [
    {
      "id": "cron-001",
      "schedule": "0 9 * * 1-5",
      "recurring": true,
      "prompt": "check the build"
    }
  ]
}
```

#### Stop 决定控制

`Stop` 和 `SubagentStop` hooks 可以控制 Claude 是否继续。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段         | 描述                                              |
| :--------- | :---------------------------------------------- |
| `decision` | `"block"` 防止 Claude 停止。省略以允许 Claude 停止          |
| `reason`   | 当 `decision` 为 `"block"` 时必需。告诉 Claude 为什么它应该继续 |

```json theme={null}
{
  "decision": "block",
  "reason": "Must be provided when Claude is blocked from stopping"
}
```

### StopFailure

当轮次因 API 错误而结束时运行，而不是[Stop](#stop)。输出和退出代码被忽略。使用此来记录失败、发送警报或在 Claude 因速率限制、身份验证问题或其他 API 错误而无法完成响应时采取恢复操作。

#### StopFailure 输入

除了[通用输入字段](#common-input-fields)外，StopFailure hooks 还接收 `error`、可选的 `error_details` 和可选的 `last_assistant_message`。`error` 字段标识错误类型，用于匹配器过滤。

| 字段                       | 描述                                                                                                                                                                   |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`                  | 错误类型：`rate_limit`、`authentication_failed`、`oauth_org_not_allowed`、`billing_error`、`invalid_request`、`model_not_found`、`server_error`、`max_output_tokens` 或 `unknown` |
| `error_details`          | 关于错误的额外详细信息（如果可用）                                                                                                                                                    |
| `last_assistant_message` | 在对话中显示的呈现错误文本。与 `Stop` 和 `SubagentStop` 不同，其中此字段包含 Claude 的对话输出，对于 `StopFailure` 它包含 API 错误字符串本身，例如 `"API Error: Rate limit reached"`                                |

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "StopFailure",
  "error": "rate_limit",
  "error_details": "429 Too Many Requests",
  "last_assistant_message": "API Error: Rate limit reached"
}
```

StopFailure hooks 没有决定控制。它们仅为通知和日志记录目的运行。

### TeammateIdle

当[代理团队](/zh-CN/agent-teams)队友在完成其轮次后即将空闲时运行。使用此来强制执行质量门，如要求通过 lint 检查或验证输出文件存在。

当 `TeammateIdle` hook 以代码 2 退出时，队友接收 stderr 消息作为反馈并继续工作而不是空闲。要完全停止队友而不是重新运行它，返回 JSON `{"continue": false, "stopReason": "..."}` 。TeammateIdle hooks 不支持匹配器，在每次出现时触发。

#### TeammateIdle 输入

除了[通用输入字段](#common-input-fields)外，TeammateIdle hooks 还接收 `teammate_name` 和 `team_name`。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TeammateIdle",
  "teammate_name": "researcher",
  "team_name": "my-project"
}
```

| 字段              | 描述         |
| :-------------- | :--------- |
| `teammate_name` | 即将空闲的队友的名称 |
| `team_name`     | 团队的名称      |

#### TeammateIdle 决定控制

TeammateIdle hooks 支持两种方式来控制队友行为：

* **退出代码 2**：队友接收 stderr 消息作为反馈并继续工作而不是空闲。
* **JSON `{"continue": false, "stopReason": "..."}`**：完全停止队友，匹配 `Stop` hook 行为。`stopReason` 向用户显示。

此示例检查构建工件是否存在，然后允许队友空闲：

```bash theme={null}
#!/bin/bash

if [ ! -f "./dist/output.js" ]; then
  echo "Build artifact missing. Run the build before stopping." >&2
  exit 2
fi

exit 0
```

### ConfigChange

当会话期间配置文件更改时运行。使用此来审计设置更改、强制执行安全策略或阻止对配置文件的未授权修改。

ConfigChange hooks 对设置文件、托管策略设置和 skill 文件的更改触发。输入中的 `source` 字段告诉您哪种类型的配置更改，可选的 `file_path` 字段提供更改文件的路径。

匹配器在配置源上过滤：

| 匹配器                | 何时触发                             |
| :----------------- | :------------------------------- |
| `user_settings`    | `~/.claude/settings.json` 更改     |
| `project_settings` | `.claude/settings.json` 更改       |
| `local_settings`   | `.claude/settings.local.json` 更改 |
| `policy_settings`  | 托管策略设置更改                         |
| `skills`           | `.claude/skills/` 中的 skill 文件更改  |

此示例记录所有配置更改以进行安全审计：

```json theme={null}
{
  "hooks": {
    "ConfigChange": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/audit-config-change.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```

#### ConfigChange 输入

除了[通用输入字段](#common-input-fields)外，ConfigChange hooks 还接收 `source` 和可选的 `file_path`。`source` 字段指示哪种配置类型更改，`file_path` 提供被修改的特定文件的路径。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "ConfigChange",
  "source": "project_settings",
  "file_path": "/Users/.../my-project/.claude/settings.json"
}
```

#### ConfigChange 决定控制

ConfigChange hooks 可以阻止配置更改生效。使用退出代码 2 或 JSON `decision` 来防止更改。被阻止时，新设置不应用于运行中的会话。

| 字段         | 描述                                 |
| :--------- | :--------------------------------- |
| `decision` | `"block"` 防止配置更改被应用。省略以允许更改        |
| `reason`   | 当 `decision` 为 `"block"` 时向用户显示的解释 |

```json theme={null}
{
  "decision": "block",
  "reason": "Configuration changes to project settings require admin approval"
}
```

`policy_settings` 更改无法被阻止。Hooks 仍然对 `policy_settings` 源触发，因此您可以使用它们进行审计日志记录，但任何阻止决定都被忽略。这确保企业管理的设置始终生效。

### CwdChanged

当会话期间工作目录更改时运行，例如当 Claude 执行 `cd` 命令时。使用此来对目录更改做出反应：重新加载环境变量、激活项目特定的工具链或自动运行设置脚本。与[FileChanged](#filechanged)配对，用于[direnv](https://direnv.net/)等管理每个目录环境的工具。

CwdChanged hooks 可以访问 `CLAUDE_ENV_FILE`。写入该文件的变量持久化到会话的后续 Bash 命令中，就像在[SessionStart hooks](#persist-environment-variables)中一样。

CwdChanged 不支持匹配器，在每次目录更改时触发。

#### CwdChanged 输入

除了[通用输入字段](#common-input-fields)外，CwdChanged hooks 还接收 `old_cwd` 和 `new_cwd`。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project/src",
  "hook_event_name": "CwdChanged",
  "old_cwd": "/Users/my-project",
  "new_cwd": "/Users/my-project/src"
}
```

#### CwdChanged 输出

除了所有 hooks 可用的[JSON 输出字段](#json-output)外，CwdChanged hooks 还可以返回 `watchPaths` 来动态设置[FileChanged](#filechanged)监视的文件路径：

| 字段           | 描述                                                                     |
| :----------- | :--------------------------------------------------------------------- |
| `watchPaths` | 绝对路径的数组。替换当前动态监视列表（来自您的 `matcher` 配置的路径始终被监视）。返回空数组会清除动态列表，这在进入新目录时很典型 |

CwdChanged hooks 没有决定控制。它们无法阻止目录更改。

### FileChanged

当监视的文件在磁盘上更改时运行。用于在项目配置文件修改时重新加载环境变量。

此事件的 `matcher` 有两个作用：

* **构建监视列表**：值在 `|` 上分割，每个段注册为工作目录中的文字文件名，因此 `".envrc|.env"` 监视恰好这两个文件。正则表达式模式在这里不有用：像 `^\.env` 这样的值会监视一个字面上名为 `^\.env` 的文件。
* **过滤哪些 hooks 运行**：当监视的文件更改时，相同的值使用标准[匹配器规则](#matcher-patterns)针对更改文件的基名过滤哪些 hook 组运行。

FileChanged hooks 可以访问 `CLAUDE_ENV_FILE`。写入该文件的变量持久化到会话的后续 Bash 命令中，就像在[SessionStart hooks](#persist-environment-variables)中一样。

#### FileChanged 输入

除了[通用输入字段](#common-input-fields)外，FileChanged hooks 还接收 `file_path` 和 `event`。

| 字段          | 描述                                                     |
| :---------- | :----------------------------------------------------- |
| `file_path` | 更改文件的绝对路径                                              |
| `event`     | 发生了什么：`"change"`（文件修改）、`"add"`（文件创建）或 `"unlink"`（文件删除） |

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project",
  "hook_event_name": "FileChanged",
  "file_path": "/Users/my-project/.envrc",
  "event": "change"
}
```

#### FileChanged 输出

除了所有 hooks 可用的[JSON 输出字段](#json-output)外，FileChanged hooks 还可以返回 `watchPaths` 来动态更新监视的文件路径：

| 字段           | 描述                                                                              |
| :----------- | :------------------------------------------------------------------------------ |
| `watchPaths` | 绝对路径的数组。替换当前动态监视列表（来自您的 `matcher` 配置的路径始终被监视）。当您的 hook 脚本根据更改的文件发现要监视的其他文件时使用此项 |

FileChanged hooks 没有决定控制。它们无法阻止文件更改的发生。

### WorktreeCreate

当您运行 `claude --worktree` 或[subagent 使用 `isolation: "worktree"`](/zh-CN/sub-agents#choose-the-subagent-scope)时，Claude Code 使用 `git worktree` 创建隔离的工作副本。如果您配置 WorktreeCreate hook，它替换默认的 git 行为，让您使用不同的版本控制系统，如 SVN、Perforce 或 Mercurial。

因为 hook 完全替换默认行为，[`.worktreeinclude`](/zh-CN/worktrees#copy-gitignored-files-into-worktrees)不被处理。如果您需要将本地配置文件（如 `.env`）复制到新 worktree，请在您的 hook 脚本内执行。

Hook 必须返回创建的 worktree 目录的绝对路径。Claude Code 使用此路径作为隔离会话的工作目录。命令 hooks 在 stdout 上打印它；HTTP hooks 通过 `hookSpecificOutput.worktreePath` 返回它。

此示例创建 SVN 工作副本并打印路径供 Claude Code 使用。用您自己的替换仓库 URL：

```json theme={null}
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'NAME=$(jq -r .name); DIR=\"$HOME/.claude/worktrees/$NAME\"; svn checkout https://svn.example.com/repo/trunk \"$DIR\" >&2 && echo \"$DIR\"'"
          }
        ]
      }
    ]
  }
}
```

Hook 从 stdin 上的 JSON 输入读取 worktree `name`，将新副本检出到新目录，并打印目录路径。最后一行的 `echo` 是 Claude Code 读取的 worktree 路径。将任何其他输出重定向到 stderr，以便它不会干扰路径。

#### WorktreeCreate 输入

除了[通用输入字段](#common-input-fields)外，WorktreeCreate hooks 还接收 `name` 字段。这是新 worktree 的 slug 标识符，由用户指定或自动生成（例如，`bold-oak-a3f2`）。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "WorktreeCreate",
  "name": "feature-auth"
}
```

#### WorktreeCreate 输出

WorktreeCreate hooks 不使用标准的允许/阻止决定模型。相反，hook 的成功或失败决定结果。Hook 必须返回创建的 worktree 目录的绝对路径：

* **命令 hooks**（`type: "command"`）：在 stdout 上打印路径。
* **HTTP hooks**（`type: "http"`）：在响应体中返回 `{ "hookSpecificOutput": { "hookEventName": "WorktreeCreate", "worktreePath": "/absolute/path" } }`。

如果 hook 失败或不产生路径，worktree 创建失败并出现错误。

### WorktreeRemove

[WorktreeCreate](#worktreecreate) 的清理对应物。此 hook 在 worktree 被移除时触发，要么当您退出 `--worktree` 会话并选择移除它时，要么当具有 `isolation: "worktree"` 的 subagent 完成时。对于基于 git 的 worktrees，Claude 使用 `git worktree remove` 自动处理清理。如果您为非 git 版本控制系统配置了 WorktreeCreate hook，将其与 WorktreeRemove hook 配对以处理清理。没有它，worktree 目录留在磁盘上。

Claude Code 将 WorktreeCreate 返回的路径作为 `worktree_path` 在 hook 输入中传递。此示例读取该路径并移除目录：

```json theme={null}
{
  "hooks": {
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'jq -r .worktree_path | xargs rm -rf'"
          }
        ]
      }
    ]
  }
}
```

#### WorktreeRemove 输入

除了[通用输入字段](#common-input-fields)外，WorktreeRemove hooks 还接收 `worktree_path` 字段，这是被移除的 worktree 的绝对路径。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "WorktreeRemove",
  "worktree_path": "/Users/.../my-project/.claude/worktrees/feature-auth"
}
```

WorktreeRemove hooks 没有决定控制。它们无法阻止 worktree 移除，但可以执行清理任务，如移除版本控制状态或存档更改。Hook 失败仅在调试模式下记录。

### PreCompact

在 Claude Code 即将运行压缩操作之前运行。

匹配器值指示压缩是手动还是自动触发：

| 匹配器      | 何时触发         |
| :------- | :----------- |
| `manual` | `/compact`   |
| `auto`   | 当上下文窗口满时自动压缩 |

退出代码 2 以阻止压缩。对于手动 `/compact`，stderr 消息向用户显示。您也可以通过返回带有 `"decision": "block"` 的 JSON 来阻止。

阻止自动压缩有不同的效果，取决于何时触发。如果压缩在上下文限制之前主动触发，Claude Code 跳过它，对话继续未压缩。如果压缩被触发以从已由 API 返回的上下文限制错误恢复，底层错误浮出并且当前请求失败。

#### PreCompact 输入

除了[通用输入字段](#common-input-fields)外，PreCompact hooks 还接收 `trigger` 和 `custom_instructions`。对于 `manual`，`custom_instructions` 包含用户传入 `/compact` 的内容。对于 `auto`，`custom_instructions` 为空。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PreCompact",
  "trigger": "manual",
  "custom_instructions": ""
}
```

### PostCompact

在 Claude Code 完成压缩操作后运行。使用此事件对新的压缩状态做出反应，例如记录生成的摘要或更新外部状态。

与 `PreCompact` 相同的匹配器值适用：

| 匹配器      | 何时触发           |
| :------- | :------------- |
| `manual` | 在 `/compact` 后 |
| `auto`   | 在上下文窗口满时自动压缩后  |

#### PostCompact 输入

除了[通用输入字段](#common-input-fields)外，PostCompact hooks 还接收 `trigger` 和 `compact_summary`。`compact_summary` 字段包含压缩操作生成的对话摘要。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PostCompact",
  "trigger": "manual",
  "compact_summary": "Summary of the compacted conversation..."
}
```

PostCompact hooks 没有决定控制。它们无法影响压缩结果，但可以执行后续任务。

### SessionEnd

当 Claude Code 会话结束时运行。用于清理任务、记录会话统计或保存会话状态。支持匹配器以按退出原因过滤。

hook 输入中的 `reason` 字段指示会话为何结束：

| 原因                            | 描述                   |
| :---------------------------- | :------------------- |
| `clear`                       | 会话使用 `/clear` 命令清除   |
| `resume`                      | 通过交互式 `/resume` 切换会话 |
| `logout`                      | 用户登出                 |
| `prompt_input_exit`           | 用户在提示输入可见时退出         |
| `bypass_permissions_disabled` | 绕过权限模式被禁用            |
| `other`                       | 其他退出原因               |

#### SessionEnd 输入

除了[通用输入字段](#common-input-fields)外，SessionEnd hooks 还接收 `reason` 字段，指示会话为何结束。有关所有值，请参阅上面的[原因表](#sessionend)。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

SessionEnd hooks 没有决定控制。它们无法阻止会话终止，但可以执行清理任务。

SessionEnd hooks 的默认超时为 1.5 秒。这适用于会话退出、`/clear` 和通过交互式 `/resume` 切换会话。如果 hook 需要更多时间，在 hook 配置中设置 `timeout`。总体预算自动提高到配置的最高每个 hook 超时，最多 60 秒。在插件提供的 hooks 上设置的超时不会提高预算。要显式覆盖预算，请在毫秒中设置 `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` 环境变量。

```bash theme={null}
CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=5000 claude
```

### Elicitation

当 MCP 服务器在任务中途请求用户输入时运行。默认情况下，Claude Code 显示交互式对话供用户响应。Hooks 可以拦截此请求并以编程方式响应，完全跳过对话。

匹配器字段与 MCP 服务器名称匹配。

#### Elicitation 输入

除了[通用输入字段](#common-input-fields)外，Elicitation hooks 还接收 `mcp_server_name`、`message` 和可选的 `mode`、`url`、`elicitation_id` 和 `requested_schema` 字段。

对于 form 模式 elicitation（最常见的情况）：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Elicitation",
  "mcp_server_name": "my-mcp-server",
  "message": "Please provide your credentials",
  "mode": "form",
  "requested_schema": {
    "type": "object",
    "properties": {
      "username": { "type": "string", "title": "Username" }
    }
  }
}
```

对于 URL 模式 elicitation（基于浏览器的身份验证）：

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Elicitation",
  "mcp_server_name": "my-mcp-server",
  "message": "Please authenticate",
  "mode": "url",
  "url": "https://auth.example.com/login"
}
```

#### Elicitation 输出

要以编程方式响应而不显示对话，返回带有 `hookSpecificOutput` 的 JSON 对象：

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "Elicitation",
    "action": "accept",
    "content": {
      "username": "alice"
    }
  }
}
```

| 字段        | 值                           | 描述                                       |
| :-------- | :-------------------------- | :--------------------------------------- |
| `action`  | `accept`、`decline`、`cancel` | 是否接受、拒绝或取消请求                             |
| `content` | object                      | 要提交的 form 字段值。仅在 `action` 为 `accept` 时使用 |

退出代码 2 拒绝 elicitation 并向用户显示 stderr。

### ElicitationResult

在用户响应 MCP elicitation 后运行。Hooks 可以观察、修改或阻止响应，然后将其发送回 MCP 服务器。

匹配器字段与 MCP 服务器名称匹配。

#### ElicitationResult 输入

除了[通用输入字段](#common-input-fields)外，ElicitationResult hooks 还接收 `mcp_server_name`、`action` 和可选的 `mode`、`elicitation_id` 和 `content` 字段。

```json theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "ElicitationResult",
  "mcp_server_name": "my-mcp-server",
  "action": "accept",
  "content": { "username": "alice" },
  "mode": "form",
  "elicitation_id": "elicit-123"
}
```

#### ElicitationResult 输出

要覆盖用户的响应，返回带有 `hookSpecificOutput` 的 JSON 对象：

```json theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "ElicitationResult",
    "action": "decline",
    "content": {}
  }
}
```

| 字段        | 值                           | 描述                                      |
| :-------- | :-------------------------- | :-------------------------------------- |
| `action`  | `accept`、`decline`、`cancel` | 覆盖用户的操作                                 |
| `content` | object                      | 覆盖 form 字段值。仅在 `action` 为 `accept` 时有意义 |

退出代码 2 阻止响应，将有效操作更改为 `decline`。

## 基于提示的 hooks

除了命令、HTTP 和 MCP tool hooks 外，Claude Code 还支持基于提示的 hooks（`type: "prompt"`），使用 LLM 来评估是否允许或阻止操作，以及代理 hooks（`type: "agent"`），生成具有工具访问权限的代理验证器。并非所有事件都支持每种 hook 类型。

支持所有五种 hook 类型（`command`、`http`、`mcp_tool`、`prompt` 和 `agent`）的事件：

* `PermissionDenied`
* `PermissionRequest`
* `PostToolBatch`
* `PostToolUse`
* `PostToolUseFailure`
* `PreToolUse`
* `Stop`
* `SubagentStop`
* `TaskCompleted`
* `TaskCreated`
* `TeammateIdle`
* `UserPromptExpansion`
* `UserPromptSubmit`

支持 `command`、`http` 和 `mcp_tool` hooks 但不支持 `prompt` 或 `agent` 的事件：

* `ConfigChange`
* `CwdChanged`
* `Elicitation`
* `ElicitationResult`
* `FileChanged`
* `InstructionsLoaded`
* `Notification`
* `PostCompact`
* `PreCompact`
* `SessionEnd`
* `StopFailure`
* `SubagentStart`
* `WorktreeCreate`
* `WorktreeRemove`

`SessionStart` 和 `Setup` 支持 `command` 和 `mcp_tool` hooks。它们不支持 `http`、`prompt` 或 `agent` hooks。

### 基于提示的 hooks 如何工作

基于提示的 hooks 不执行 Bash 命令，而是：

1. 将 hook 输入和您的提示发送到 Claude 模型，默认为 Haiku
2. LLM 使用包含决定的结构化 JSON 响应
3. Claude Code 自动处理决定

### 提示 hook 配置

将 `type` 设置为 `"prompt"` 并提供 `prompt` 字符串而不是 `command`。使用 `$ARGUMENTS` 占位符将 hook 的 JSON 输入数据注入到您的提示文本中。Claude Code 将组合的提示和输入发送到快速 Claude 模型，该模型返回 JSON 决定。

此 `Stop` hook 要求 LLM 在允许 Claude 完成之前评估是否应该停止：

```json theme={null}
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate if Claude should stop: $ARGUMENTS. Check if all tasks are complete."
          }
        ]
      }
    ]
  }
}
```

| 字段                | 必需 | 描述                                                                                                                                            |
| :---------------- | :- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`            | 是  | 必须是 `"prompt"`                                                                                                                                |
| `prompt`          | 是  | 要发送给 LLM 的提示文本。使用 `$ARGUMENTS` 作为 hook 输入 JSON 的占位符。如果 `$ARGUMENTS` 不存在，输入 JSON 被追加到提示                                                        |
| `model`           | 否  | 用于评估的模型。默认为快速模型                                                                                                                               |
| `timeout`         | 否  | 超时（秒）。默认值：30                                                                                                                                  |
| `continueOnBlock` | 否  | 当提示返回 `ok: false` 时，将原因反馈给 Claude 并继续转轮而不是停止。默认值：`false`。在生成的 `decision: "block"` 上实现为 `continue: true`。有关每个事件的行为，请参阅[响应架构](#response-schema) |

### 响应架构

LLM 必须使用包含以下内容的 JSON 响应：

```json theme={null}
{
  "ok": true | false,
  "reason": "Explanation for the decision"
}
```

| 字段       | 描述                                                    |
| :------- | :---------------------------------------------------- |
| `ok`     | `true` 允许。`false` 产生 `decision: "block"`。请参阅下面的每个事件行为 |
| `reason` | 当 `ok` 为 `false` 时必需。用作阻止原因                           |

`ok: false` 时发生的情况取决于事件：

* `Stop` 和 `SubagentStop`：原因被反馈给 Claude 作为其下一条指令，转轮继续
* `PreToolUse`：工具调用被拒绝，原因作为工具错误返回给 Claude，等同于命令 hook 的 `permissionDecision: "deny"`
* `PostToolUse`：默认情况下转轮结束，原因在聊天中显示为警告行。设置 `continueOnBlock: true` 以将原因反馈给 Claude 并继续转轮
* `PostToolBatch`、`UserPromptSubmit` 和 `UserPromptExpansion`：转轮结束，原因显示为警告行。这些事件在 `decision: "block"` 上结束转轮，无论 `continue` 如何
* `PostToolUseFailure`、`TaskCreated` 和 `TaskCompleted`：原因作为工具错误返回给 Claude，类似于 `PreToolUse`
* `TeammateIdle`：默认情况下队友停止，原因显示为警告行。设置 `continueOnBlock: true` 以将原因反馈给队友并保持其继续工作
* `PermissionRequest`：`ok: false` 无效。要从 hook 拒绝批准，请使用[命令 hook](#command-hook-fields)，返回 `hookSpecificOutput.decision.behavior: "deny"`
* `PermissionDenied`：`ok: false` 无效，因为拒绝已经发生。此事件读取的唯一输出是 `hookSpecificOutput.retry`，提示和代理 hooks 无法设置 — 它们在此事件上运行，但其输出被丢弃。使用[命令 hook](#command-hook-fields)返回 `retry`

如果您需要对任何事件进行更精细的控制，请使用[命令 hook](#command-hook-fields)，其中包含[决定控制](#decision-control)中描述的每个事件字段。

### 示例：多条件 Stop hook

此 `Stop` hook 使用详细提示检查三个条件，然后允许 Claude 停止。如果 `"ok"` 为 `false`，Claude 继续工作，提供的原因作为其下一条指令。`SubagentStop` hooks 使用相同的格式来评估[子代理](/zh-CN/sub-agents)是否应该停止：

```json theme={null}
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are evaluating whether Claude should stop working. Context: $ARGUMENTS\n\nAnalyze the conversation and determine if:\n1. All user-requested tasks are complete\n2. Any errors need to be addressed\n3. Follow-up work is needed\n\nRespond with JSON: {\"ok\": true} to allow stopping, or {\"ok\": false, \"reason\": \"your explanation\"} to continue working.",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## 基于代理的 hooks

<Warning>
  代理 hooks 是实验性的。行为和配置可能在未来版本中更改。对于生产工作流，建议使用[命令 hooks](#command-hook-fields)。
</Warning>

基于代理的 hooks（`type: "agent"`）类似于基于提示的 hooks，但具有多轮工具访问。代理 hook 生成一个可以读取文件、搜索代码和检查代码库以验证条件的 subagent，而不是单个 LLM 调用。代理 hooks 支持与基于提示的 hooks 相同的事件。

### 基于代理的 hooks 如何工作

当代理 hook 触发时：

1. Claude Code 生成一个 subagent，带有您的提示和 hook 的 JSON 输入
2. Subagent 可以使用 Read、Grep 和 Glob 等工具进行调查
3. 在最多 50 轮后，subagent 返回结构化的 `{ "ok": true/false }` 决定
4. Claude Code 以与提示 hook 相同的方式处理决定

代理 hooks 在验证需要检查实际文件或测试输出时很有用，而不仅仅是评估 hook 输入数据。

### 代理 hook 配置

将 `type` 设置为 `"agent"` 并提供 `prompt` 字符串。配置字段与[提示 hooks](#prompt-hook-configuration)相同，但超时更长：

| 字段        | 必需 | 描述                                               |
| :-------- | :- | :----------------------------------------------- |
| `type`    | 是  | 必须是 `"agent"`                                    |
| `prompt`  | 是  | 描述要验证的内容的提示。使用 `$ARGUMENTS` 作为 hook 输入 JSON 的占位符 |
| `model`   | 否  | 要使用的模型。默认为快速模型                                   |
| `timeout` | 否  | 超时（秒）。默认值：60                                     |

响应架构与提示 hooks 相同：`{ "ok": true }` 允许或 `{ "ok": false, "reason": "..." }` 阻止。

此 `Stop` hook 验证所有单元测试通过，然后允许 Claude 完成：

```json theme={null}
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify that all unit tests pass. Run the test suite and check the results. $ARGUMENTS",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

## 在后台运行 Hooks

默认情况下，hooks 阻止 Claude 的执行，直到它们完成。对于长时间运行的任务，如部署、测试套件或外部 API 调用，设置 `"async": true` 以在后台运行 hook，同时 Claude 继续工作。异步 hooks 无法阻止或控制 Claude 的行为：响应字段如 `decision`、`permissionDecision` 和 `continue` 无效，因为它们会控制的操作已经完成。

### 配置异步 Hook

将 `"async": true` 添加到命令 hook 的配置以在后台运行它而不阻止 Claude。此字段仅在 `type: "command"` hooks 上可用。

此 hook 在每个 `Write` 工具调用后运行测试脚本。Claude 立即继续工作，同时 `run-tests.sh` 执行最多 120 秒。脚本完成时，其输出在下一个对话轮次上传递：

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/run-tests.sh",
            "async": true,
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

`timeout` 字段设置后台进程的最大时间（秒）。如果未指定，异步 hooks 使用与同步 hooks 相同的 10 分钟默认值。

### 异步 Hooks 如何执行

当异步 hook 触发时，Claude Code 启动 hook 进程并立即继续，不等待其完成。Hook 通过 stdin 接收与同步 hook 相同的 JSON 输入。

后台进程退出后，如果 hook 产生了带有 `additionalContext` 字段的 JSON 响应，该内容在下一个对话轮次作为上下文传递给 Claude。`systemMessage` 字段显示给你，而不是 Claude。

异步 hook 完成通知默认被抑制。要查看它们，请使用 `Ctrl+O` 启用详细模式或使用 `--verbose` 启动 Claude Code。

### 示例：文件更改后运行测试

此 hook 在 Claude 写入文件时在后台启动测试套件，然后在测试完成时将结果报告回 Claude。将此脚本保存到项目中的 `.claude/hooks/run-tests-async.sh` 并使用 `chmod +x` 使其可执行：

```bash theme={null}
#!/bin/bash
# run-tests-async.sh

# 从 stdin 读取 hook 输入
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# 仅对源文件运行测试
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.js ]]; then
  exit 0
fi

# 运行测试并通过 additionalContext 向 Claude 报告结果
RESULT=$(npm test 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  MSG="Tests passed after editing $FILE_PATH"
else
  MSG="Tests failed after editing $FILE_PATH: $RESULT"
fi
jq -nc --arg msg "$MSG" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $msg}}'
```

然后将此配置添加到项目根目录中的 `.claude/settings.json`。`async: true` 标志让 Claude 在测试运行时继续工作：

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/run-tests-async.sh",
            "args": [],
            "async": true,
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

### 限制

异步 hooks 与同步 hooks 相比有几个限制：

* 仅 `type: "command"` hooks 支持 `async`。基于提示的 hooks 无法异步运行。
* 异步 hooks 无法阻止工具调用或返回决定。到 hook 完成时，触发操作已经进行。
* Hook 输出在下一个对话轮次传递。如果会话空闲，响应等待直到下一个用户交互。例外：`asyncRewake` hook 在退出代码 2 时立即唤醒 Claude，即使会话空闲。
* 每次执行创建一个单独的后台进程。同一异步 hook 的多个触发之间没有去重。

## 安全考虑

### 免责声明

命令 hooks 使用您的系统用户的完整权限运行。

<Warning>
  命令 hooks 使用您的完整用户权限执行 shell 命令。它们可以修改、删除或访问您的用户帐户可以访问的任何文件。在将任何 hook 命令添加到您的配置之前，请审查并测试它们。
</Warning>

### 安全最佳实践

编写 hooks 时请记住这些实践：

* **验证和清理输入**：永远不要盲目信任输入数据
* **始终引用 shell 变量**：使用 `"$VAR"` 而不是 `$VAR`
* **阻止路径遍历**：检查文件路径中的 `..`
* **使用绝对路径**：为脚本指定完整路径。在 exec 形式中，使用 `${CLAUDE_PROJECT_DIR}` 且路径无需引用。在 shell 形式中，将其包装在双引号中
* **跳过敏感文件**：避免 `.env`、`.git/`、密钥等

## Windows PowerShell 工具

在 Windows 上，您可以通过在命令 hook 上设置 `"shell": "powershell"` 在 PowerShell 中运行单个 hooks。Hooks 直接生成 PowerShell，因此这适用于是否设置了 `CLAUDE_CODE_USE_POWERSHELL_TOOL`。Claude Code 自动检测 `pwsh.exe`（PowerShell 7+），回退到 `powershell.exe`（5.1）。

```json theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "command": "Write-Host 'File written'"
          }
        ]
      }
    ]
  }
}
```

## 调试 hooks

Hook 执行详细信息，包括哪些 hooks 匹配、它们的退出代码和完整 stdout 和 stderr，被写入调试日志文件。使用 `claude --debug-file <path>` 启动 Claude Code 以将日志写入已知位置，或运行 `claude --debug` 并在 `~/.claude/debug/<session-id>.txt` 读取日志。`--debug` 标志不打印到终端。

```text theme={null}
[DEBUG] Executing hooks for PostToolUse:Write
[DEBUG] Found 1 hook commands to execute
[DEBUG] Executing hook command: <Your command> with timeout 600000ms
[DEBUG] Hook command completed with status 0: <Your stdout>
```

对于更细粒度的 hook 匹配详细信息，设置 `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` 以查看额外的日志行，例如 hook 匹配器计数和查询匹配。

有关故障排除常见问题，如 hooks 不触发、Stop hooks 持续阻止或配置错误，请参阅指南中的[限制和故障排除](/zh-CN/hooks-guide#limitations-and-troubleshooting)。有关涵盖 `/context`、`/doctor` 和设置优先级的更广泛的诊断演练，请参阅[调试你的配置](/zh-CN/debug-your-config)。
