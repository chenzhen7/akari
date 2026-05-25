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

export type AgentType = 'claude' | 'aider' | 'shell'

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

export interface ApprovalRequest {
  type: 'checkpoint' | 'destructive-op' | 'merge-ready'
  message: string
  diff?: GitDiff
  command?: string
  timestamp: Date
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
  diffSummary: string
  diffFull?: string
  diffFiles?: DiffFile[]

  createdAt: Date
  tags: string[]
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
  | { event: 'diff:update'; payload: { sessionId: string; diff: GitDiff } }
  | { event: 'approval:required'; payload: { sessionId: string; request: ApprovalRequest } }
  | { event: 'checkpoint:reached'; payload: { sessionId: string; description: string; timestamp: string } }
  | { event: 'sessions:list'; payload: AgentSession[] }
  | { event: 'git:log-updated'; payload: { sessionId: string } & GitLogResponse }

export type ClientMessage =
  | { event: 'terminal:input'; payload: { sessionId: string; data: string } }
  | { event: 'terminal:resize'; payload: { sessionId: string; cols: number; rows: number } }
  | { event: 'approval:decision'; payload: { sessionId: string; decision: 'approved' | 'rejected'; comment?: string } }
  | { event: 'broadcast:send'; payload: { message: string; targets?: string[] } }
