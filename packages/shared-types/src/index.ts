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

export type KanbanColumn =
  | 'backlog'
  | 'in-progress'
  | 'waiting-review'
  | 'approved'
  | 'done'

export type AgentType = 'claude' | 'aider' | 'shell' | 'claude-orchestrator'

export type CollaborationRole = 'standalone' | 'orchestrator' | 'worker' | 'reviewer'

export interface CanvasEdge {
  id: string
  sourceSessionId: string
  targetSessionId: string
  trigger: 'on-complete' | 'on-approval'
  injectContext: boolean
}

export interface DiffFile {
  path: string
  status: 'A' | 'M' | 'D' | 'R'
  additions: number
  deletions: number
}

export interface GitDiff {
  stat: string
  fullDiff: string
  files: DiffFile[]
  summary: { additions: number; deletions: number; files: number }
}

export interface ApprovalOption {
  key: string        // '1' | '2' | '3'
  label: string      // 'Yes' | 'Yes, and always allow...'
  description?: string
}

export interface ApprovalRequest {
  type: 'checkpoint' | 'destructive-op' | 'merge-ready'
  message: string
  description?: string
  diff?: GitDiff
  command?: string
  timestamp: Date
  /** Options to show in the approval prompt (default: standard Yes/No/Cancel) */
  options?: ApprovalOption[]
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
  pendingApproval?: ApprovalRequest

  progress: number
  terminalOutput: string[]
  lastAiMessage: string
  diffSummary: string
  diffFull?: string
  diffFiles?: DiffFile[]

  createdAt: Date
  tags: string[]

  collaborationRole: CollaborationRole
  parentSessionId?: string
  childSessionIds: string[]
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

export type ServerMessage =
  | { event: 'session:created'; payload: AgentSession }
  | { event: 'session:updated'; payload: AgentSession }
  | { event: 'session:status'; payload: { id: string; status: SessionStatus; progress: number } }
  | { event: 'terminal:data'; payload: { sessionId: string; data: string } }
  | { event: 'terminal:ready'; payload: { sessionId: string } }
  | { event: 'terminal:resized'; payload: { sessionId: string } }
  | { event: 'diff:update'; payload: { sessionId: string; diff: GitDiff } }
  | { event: 'approval:required'; payload: { sessionId: string; request: ApprovalRequest } }
  | { event: 'sessions:list'; payload: AgentSession[] }
  | { event: 'git:log-updated'; payload: { sessionId: string } & GitLogResponse }
  | { event: 'session:lastMessage'; payload: { id: string; lastAiMessage: string } }
  | { event: 'canvas:edges'; payload: CanvasEdge[] }

export type ClientMessage =
  | { event: 'terminal:input'; payload: { sessionId: string; data: string } }
  | { event: 'terminal:resize'; payload: { sessionId: string; cols: number; rows: number } }
  | { event: 'approval:decision'; payload: { sessionId: string; decision: 'approved' | 'rejected'; comment?: string } }
  | { event: 'broadcast:send'; payload: { message: string; targets?: string[] } }

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
    permissionDecision?: 'approve' | 'deny'
    permissionDecisionReason?: string
  }
}
