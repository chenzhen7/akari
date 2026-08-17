export type SessionStatus =
  | 'initializing'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'review'
  | 'approved'
  | 'completed'
  | 'failed'
  | 'merged'
  | 'archived'
  | 'idle'

export type KanbanColumn =
  | 'backlog'
  | 'in-progress'
  | 'waiting-review'
  | 'approved'
  | 'done'

export type AgentType = 'claude' | 'aider' | 'shell' | 'kimi' | 'claude-orchestrator'

export type CollaborationRole = 'standalone' | 'orchestrator' | 'worker' | 'reviewer'

export interface CanvasEdge {
  id: string
  sourceSessionId: string
  targetSessionId: string
  trigger: 'on-complete'
  injectContext: boolean
}

export interface DiffFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R'
  additions: number
  deletions: number
}

export type DiffLineType = 'context' | 'added' | 'removed'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffHunk {
  id: string
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
  additions: number
  deletions: number
}

export interface FileDiffLine {
  type: 'added' | 'removed' | 'modified'
  lineNumber: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface GitDiff {
  files: DiffFile[]
  summary: { additions: number; deletions: number; files: number }
  truncated?: boolean
}

export interface FileChangeEvent {
  sessionId: string
  filePath: string
  changeType: 'add' | 'change' | 'unlink'
}

export interface SessionTab {
  id: string
  type: 'terminal' | 'agent' | 'diff' | 'file' | 'review'
  label: string
  filePath?: string
  terminalId?: string
  agentType?: AgentType
  /** diff tab 指向的历史提交：存在时 DiffViewer 拉取该提交的 diff（parent vs commit），而非工作区 diff */
  commitHash?: string
  /** PTY shell/TUI 通过 OSC 0/1/2 上报的实时标题（净化后），显示优先级高于 label */
  titleFromShell?: string
}

export interface AgentSession {
  id: string
  name: string
  task: string
  status: SessionStatus
  agentType: AgentType

  worktreePath: string
  branchName: string
  baseBranch: string

  canvasPosition: { x: number; y: number }
  canvasSize: { width: number; height: number }

  kanbanColumn: KanbanColumn
  terminalId: string

  progress: number
  terminalOutput: string[]
  lastAiMessage: string
  diffSummary: { additions: number; deletions: number }
  diffFiles?: DiffFile[]
  aheadBehind?: AheadBehind | null

  createdAt: Date
  tags: string[]

  collaborationRole: CollaborationRole
  parentSessionId?: string
  childSessionIds: string[]

  tabs: SessionTab[]
  activeTabId: string | null
  workspaceId: string
  isMain?: boolean
}

export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  email: string
  date: string
  parents: string[]
  refs: string[]
}

export interface GitBranch {
  name: string
  commit: string
  isCurrent: boolean
  isRemote: boolean
}

/** 相对分支上游的领先/落后提交数（无上游时为 null）。ref 为上游分支名，如 'origin/main' */
export interface AheadBehind {
  ahead: number
  behind: number
  ref: string
}

export interface GitLogResponse {
  commits: GitCommit[]
  branches: GitBranch[]
  head: string
}

export interface Workspace {
  id: string
  name: string
  path: string
  repoRoot: string
  isGit: boolean
  pinned: boolean
  createdAt: Date
  lastOpenedAt: Date
}

export type ServerMessage =
  | { event: 'session:created'; payload: AgentSession }
  | { event: 'session:updated'; payload: AgentSession }
  | { event: 'session:status'; payload: { id: string; status: SessionStatus; progress: number; kanbanColumn: KanbanColumn } }
  | { event: 'session:deleted'; payload: { id: string } }
  | { event: 'terminal:data'; payload: { sessionId: string; terminalId: string; data: string } }
  | { event: 'terminal:ready'; payload: { sessionId: string; terminalId: string } }
  | { event: 'terminal:resized'; payload: { sessionId: string; terminalId: string } }
  | { event: 'diff:update'; payload: { sessionId: string; diff: GitDiff } }
  | { event: 'git:ahead-behind'; payload: { sessionId: string; aheadBehind: AheadBehind | null } }
  | { event: 'file:update'; payload: FileChangeEvent }
  | { event: 'sessions:list'; payload: AgentSession[] }
  | { event: 'git:log-updated'; payload: { sessionId: string } & GitLogResponse }
  | { event: 'session:lastMessage'; payload: { id: string; lastAiMessage: string } }
  | { event: 'session:unread'; payload: { id: string } }
  | { event: 'canvas:edges'; payload: CanvasEdge[] }
  | { event: 'tab:created'; payload: { sessionId: string; tab: SessionTab } }
  | { event: 'tab:closed'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:activated'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:title'; payload: { sessionId: string; tabId: string; title: string } }
  | { event: 'tabs:sync'; payload: { sessionId: string; tabs: SessionTab[]; activeTabId: string | null } }
  | { event: 'workspace:list'; payload: Workspace[] }
  | { event: 'workspace:activated'; payload: Workspace }

export type ClientMessage =
  | { event: 'terminal:input'; payload: { sessionId: string; terminalId: string; data: string } }
  | { event: 'terminal:resize'; payload: { sessionId: string; terminalId: string; cols: number; rows: number } }
  | { event: 'broadcast:send'; payload: { message: string; targets?: string[] } }
  | { event: 'tab:create'; payload: { sessionId: string; type: 'terminal' | 'agent' | 'diff' | 'file' | 'review'; filePath?: string; commitHash?: string } }
  | { event: 'tab:close'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:activate'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:reorder'; payload: { sessionId: string; orderedTabIds: string[] } }
  | { event: 'terminal:create'; payload: { sessionId: string; agentType?: AgentType; bypassPermissions?: boolean } }
  | { event: 'subscribe:workspace'; payload: { workspaceId: string } }

// ─── HTTP Hook Event Types ───────────────────────────────────────────────────
// 只保留 PermissionRequest / Stop 两个事件，用于会话「未读红点」提醒；
// Hook 不再驱动会话状态机流转。

export type HookEventName =
  | 'PermissionRequest'
  | 'Stop'

interface HookEventBase {
  hook_event_name: HookEventName
  session_id: string
}

export interface PermissionRequestPayload extends HookEventBase {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: Record<string, unknown>
}

export interface StopPayload extends HookEventBase {
  hook_event_name: 'Stop'
  last_assistant_message: string
}

export type HookEvent =
  | PermissionRequestPayload
  | StopPayload

export interface HookResponse {
  hookSpecificOutput?: {
    hookEventName: HookEventName
  }
}
