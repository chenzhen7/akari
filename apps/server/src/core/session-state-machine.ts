import type { KanbanColumn, SessionStatus } from '@akari/shared-types'

export const STATUS_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  initializing: ['idle', 'failed'],
  running: ['idle', 'waiting', 'paused', 'completed', 'failed', 'archived'],
  idle: ['running', 'failed', 'archived'],
  waiting: ['running', 'paused', 'failed', 'archived'],
  approved: ['running', 'archived'],
  paused: ['running', 'waiting', 'failed', 'archived'],
  review: ['completed', 'running', 'archived'],
  completed: ['merged', 'archived', 'running'],
  failed: ['archived', 'running'],
  merged: ['archived'],
  archived: ['paused'],
}

export const STATUS_TO_KANBAN: Partial<Record<SessionStatus, KanbanColumn>> = {
  initializing: 'backlog',
  running: 'in-progress',
  idle: 'backlog',
  waiting: 'waiting-review',
  paused: 'in-progress',
  review: 'waiting-review',
  approved: 'approved',
  completed: 'done',
  failed: 'done',
  merged: 'done',
  archived: 'done',
}

export function validateTransition(from: SessionStatus, to: SessionStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}
