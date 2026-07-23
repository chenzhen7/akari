import { nanoid } from 'nanoid'
import type {
  AgentSession,
  AgentType,
  KanbanColumn,
  SessionStatus,
} from '@akari/shared-types'

export interface CreateSessionInput {
  name: string
  task: string
  agentType: AgentType
  baseBranch: string
  workspaceId: string
  canvasPosition?: { x: number; y: number }
  parentSessionId?: string
  tags?: string[]
}

export function createAgentSession(input: CreateSessionInput): AgentSession {
  const id = nanoid(8)
  return {
    id,
    name: input.name.trim(),
    task: input.task.trim(),
    status: 'initializing' as SessionStatus,
    agentType: input.agentType,
    worktreePath: '',
    branchName: `agent/${id.slice(0, 8)}`,
    baseBranch: input.baseBranch,
    canvasPosition: input.canvasPosition ?? {
      x: 100 + Math.random() * 600,
      y: 100 + Math.random() * 400,
    },
    canvasSize: { width: 280, height: 280 },
    kanbanColumn: 'backlog' as KanbanColumn,
    terminalId: nanoid(8),
    progress: 0,
    terminalOutput: [],
    lastAiMessage: '',
    diffSummary: { additions: 0, deletions: 0 },
    createdAt: new Date(),
    tags: input.tags ?? [],
    collaborationRole: 'standalone',
    parentSessionId: input.parentSessionId,
    childSessionIds: [],
    tabs: [],
    activeTabId: null,
    workspaceId: input.workspaceId,
  }
}

export function createMainSession(
  workspacePath: string,
  workspaceId: string,
  currentBranch: string,
): AgentSession {
  const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? '主工作区'
  const id = nanoid(8)
  return {
    id,
    name: workspaceName,
    task: '主分支',
    status: 'idle' as SessionStatus,
    agentType: 'shell',
    worktreePath: workspacePath,
    branchName: currentBranch,
    baseBranch: currentBranch,
    canvasPosition: { x: 50, y: 50 },
    canvasSize: { width: 280, height: 280 },
    kanbanColumn: 'backlog' as KanbanColumn,
    terminalId: '',
    progress: 0,
    terminalOutput: [],
    lastAiMessage: '',
    diffSummary: { additions: 0, deletions: 0 },
    createdAt: new Date(),
    tags: [],
    collaborationRole: 'standalone',
    parentSessionId: undefined,
    childSessionIds: [],
    tabs: [],
    activeTabId: null,
    workspaceId,
    isMain: true,
  }
}
