export type SessionStatus =
  | 'initializing'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'review'
  | 'completed'
  | 'failed'

export type KanbanColumn =
  | 'backlog'
  | 'in-progress'
  | 'waiting-review'
  | 'approved'
  | 'done'

export interface AgentSession {
  id: string
  name: string
  task: string
  status: SessionStatus
  branchName: string
  baseBranch: string
  progress: number
  kanbanColumn: KanbanColumn
  canvasPosition: { x: number; y: number }
  canvasSize: { width: number; height: number }
  terminalOutput: string[]
  diffSummary: string
  createdAt: Date
  tags: string[]
}
