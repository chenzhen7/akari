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
  stat: string
  fullDiff: string
  files: DiffFile[]
  summary: { additions: number; deletions: number; files: number }
}

export interface FileChangeEvent {
  sessionId: string
  filePath: string
  changeType: 'add' | 'change' | 'unlink'
}

export interface SessionTab {
  id: string
  type: 'terminal' | 'agent' | 'diff' | 'file'
  label: string
  filePath?: string
  terminalId?: string
  agentType?: AgentType
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
  diffFull?: string
  diffFiles?: DiffFile[]

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
  | { event: 'session:status'; payload: { id: string; status: SessionStatus; progress: number } }
  | { event: 'terminal:data'; payload: { sessionId: string; terminalId: string; data: string } }
  | { event: 'terminal:ready'; payload: { sessionId: string; terminalId: string } }
  | { event: 'terminal:resized'; payload: { sessionId: string; terminalId: string } }
  | { event: 'diff:update'; payload: { sessionId: string; diff: GitDiff } }
  | { event: 'file:update'; payload: FileChangeEvent }
  | { event: 'sessions:list'; payload: AgentSession[] }
  | { event: 'git:log-updated'; payload: { sessionId: string } & GitLogResponse }
  | { event: 'session:lastMessage'; payload: { id: string; lastAiMessage: string } }
  | { event: 'canvas:edges'; payload: CanvasEdge[] }
  | { event: 'tab:created'; payload: { sessionId: string; tab: SessionTab } }
  | { event: 'tab:closed'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:activated'; payload: { sessionId: string; tabId: string } }
  | { event: 'tabs:sync'; payload: { sessionId: string; tabs: SessionTab[]; activeTabId: string | null } }
  | { event: 'workspace:list'; payload: Workspace[] }
  | { event: 'workspace:activated'; payload: Workspace }

export type ClientMessage =
  | { event: 'terminal:input'; payload: { sessionId: string; terminalId: string; data: string } }
  | { event: 'terminal:resize'; payload: { sessionId: string; terminalId: string; cols: number; rows: number } }
  | { event: 'broadcast:send'; payload: { message: string; targets?: string[] } }
  | { event: 'tab:create'; payload: { sessionId: string; type: 'terminal' | 'agent' | 'diff' | 'file'; filePath?: string } }
  | { event: 'tab:close'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:activate'; payload: { sessionId: string; tabId: string } }
  | { event: 'tab:reorder'; payload: { sessionId: string; orderedTabIds: string[] } }
  | { event: 'terminal:create'; payload: { sessionId: string; agentType?: AgentType; bypassPermissions?: boolean } }
  | { event: 'subscribe:workspace'; payload: { workspaceId: string } }

// ─── Phase 8: HTTP Hook Event Types ──────────────────────────────────────────

export type HookEventName =
  | 'SessionStart'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'Stop'
  | 'StopFailure'
  | 'UserPromptSubmit'

interface HookEventBase {
  hook_event_name: HookEventName
  session_id: string
}

export interface SessionStartPayload extends HookEventBase {
  hook_event_name: 'SessionStart'
}

export interface PermissionRequestPayload extends HookEventBase {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: Record<string, unknown>
}

export interface PostToolUsePayload extends HookEventBase {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response?: unknown
}

export interface TaskCreatedPayload extends HookEventBase {
  hook_event_name: 'TaskCreated'
  description?: string
}

export interface TaskCompletedPayload extends HookEventBase {
  hook_event_name: 'TaskCompleted'
  description?: string
}

export interface StopPayload extends HookEventBase {
  hook_event_name: 'Stop'
  last_assistant_message: string
}

export interface StopFailurePayload extends HookEventBase {
  hook_event_name: 'StopFailure'
  error?: string
}

export interface UserPromptSubmitPayload extends HookEventBase {
  hook_event_name: 'UserPromptSubmit'
}

export type HookEvent =
  | SessionStartPayload
  | PermissionRequestPayload
  | PostToolUsePayload
  | TaskCreatedPayload
  | TaskCompletedPayload
  | StopPayload
  | StopFailurePayload
  | UserPromptSubmitPayload

export interface HookResponse {
  hookSpecificOutput?: {
    hookEventName: HookEventName
  }
}
