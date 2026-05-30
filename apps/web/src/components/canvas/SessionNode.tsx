import { memo, useState, useRef } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GitBranch, Archive, Trash2, Bot, Code2, Terminal, Bell, Crown, Plus, RotateCcw, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type SessionNodeData = {
  session: AgentSession
}

type SessionNodeType = Node<SessionNodeData>

const agentConfig: Record<string, { bg: string; Icon: LucideIcon }> = {
  claude: { bg: '#7c3aed', Icon: Bot },
  'claude-orchestrator': { bg: '#b45309', Icon: Crown },
  aider: { bg: '#2563eb', Icon: Code2 },
  shell: { bg: '#374151', Icon: Terminal },
}

const statusConfig: Record<string, { color: string; label: string }> = {
  running: { color: '#22c55e', label: '运行中' },
  waiting: { color: '#f59e0b', label: '待审批' },
  failed: { color: '#ef4444', label: '失败' },
  completed: { color: '#3b82f6', label: '已完成' },
  initializing: { color: '#94a3b8', label: '初始化中' },
  paused: { color: '#f97316', label: '已暂停' },
  review: { color: '#a855f7', label: '审查中' },
  archived: { color: '#64748b', label: '已归档' },
}

function truncateMessage(msg: string, maxLen = 200): string {
  const cleaned = msg
    .replace(/```[\s\S]*?```/g, '[代码块]')
    .replace(/`[^`]*`/g, (m) => m.slice(0, 20))
    .trim()
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '…' : cleaned
}

function SessionNodeInner({ data }: NodeProps<SessionNodeType>) {
  const session = data.session
  const archiveSession = useSessionStore(s => s.archiveSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const pendingOps = useSessionStore(s => s.pendingOps)
  const [hovered, setHovered] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const hoverLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onEnter = () => {
    if (hoverLeaveRef.current) { clearTimeout(hoverLeaveRef.current); hoverLeaveRef.current = null }
    setHovered(true)
  }
  const onLeave = () => {
    hoverLeaveRef.current = setTimeout(() => setHovered(false), 60)
  }

  const cfg = statusConfig[session.status] ?? statusConfig.initializing
  const isArchived = session.status === 'archived'
  const isPending = pendingOps.has(session.id)
  const color = cfg.color

  function stopBubble(e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
  }

  const roleLabel: Record<string, string> = {
    orchestrator: 'Orchestrator',
    worker: 'Worker',
    reviewer: 'Reviewer',
  }

  return (
    <>
      {/* LEFT: 物理 Handle，尺寸设为极小的 1px * 1px，确保 ReactFlow 连线端点绝对、精准对齐在卡片左边缘（x=0） */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1 !w-1 !bg-transparent !border-none !cursor-crosshair !z-20 !overflow-visible"
        style={{
          left: 0,
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {/* 视觉圆球：通过绝对定位，在物理 Handle（x=0）的基础上往左偏移 36px (即 24px 悬空 + 12px 半径)，
            由于事件冒泡，在此圆球上 Hover/点击/拖拉会完美传导至 Handle，触发完美的悬浮显示与连线拖拽 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -left-[36px] flex h-6 w-6 items-center justify-center rounded-full bg-[#1c1c1c] border border-white/25 transition-opacity duration-150 shadow-xl"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <Plus className="h-3 w-3 text-white/60 pointer-events-none" />
        </div>
      </Handle>

      {/* RIGHT: 物理 Handle，尺寸极小，确保连线端点绝对、精准对齐在卡片右边缘 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1 !w-1 !bg-transparent !border-none !cursor-crosshair !z-20 !overflow-visible"
        style={{
          right: 0,
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {/* 视觉圆球：在物理 Handle（x=268）的基础上往右偏移 36px */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -right-[36px] flex h-6 w-6 items-center justify-center rounded-full bg-[#1c1c1c] border border-white/25 transition-opacity duration-150 shadow-xl"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <Plus className="h-3 w-3 text-white/60 pointer-events-none" />
        </div>
      </Handle>
      <div
        className="relative w-[268px] cursor-pointer select-none rounded-[22px] pb-1"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, #242424 0%, #111111 75%)',
          boxShadow: hovered
            ? [
              'inset 0 14px 3px -13px rgba(255,255,255,0.22)',
              '0 0 0 1px rgba(255,255,255,0.10)',
              `0 0 0 1px ${color}45`,
              `0 0 24px ${color}20`,
              '0 20px 48px rgba(0,0,0,0.80)',
            ].join(', ')
            : [
              'inset 0 14px 3px -13px rgba(255,255,255,0.10)',
              '0 0 0 1px rgba(255,255,255,0.06)',
              `0 0 0 1px ${color}28`,
              '0 8px 24px rgba(0,0,0,0.65)',
            ].join(', '),
          transition: 'box-shadow 0.2s ease',
        }}
      >
        {/* Waiting approval pulse glow */}
        {session.status === 'waiting' && (
          <div
            className="pointer-events-none absolute inset-0 rounded-[22px] animate-pulse"
            style={{ boxShadow: '0 0 0 2px #f59e0b55, 0 0 28px #f59e0b28' }}
          />
        )}

        {/* Luminous top radial glow */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{ background: 'radial-gradient(ellipse at 50% -15%, rgba(255,255,255,0.07) 0%, transparent 65%)' }}
        />
        {/* Luminous slit — horizontal light line */}
        <div
          className="pointer-events-none absolute inset-x-0"
          style={{
            top: '46px',
            height: '1px',
            background: 'linear-gradient(90deg, transparent 8%, rgba(255,255,255,0.10) 50%, transparent 92%)',
          }}
        />

        {/* Hover action buttons */}
        <div
          className={cn(
            'absolute right-2.5 top-3 z-10 flex items-center gap-1 transition-all duration-150',
            hovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none',
          )}
          onClick={stopBubble}
          onMouseDown={stopBubble}
          onPointerDown={stopBubble}
          onPointerUp={stopBubble}
        >
          {!isArchived && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
                  style={{ background: 'hsl(var(--muted) / 0.8)', backdropFilter: 'blur(8px)' }}
                  disabled={isPending}
                  onClick={() => archiveSession(session.id)}
                >
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">归档（终止进程，保留 Worktree）</TooltipContent>
            </Tooltip>
          )}
          {isArchived && !isPending && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-1.5 text-blue-400 transition-colors hover:text-blue-300"
                  style={{ background: 'hsl(var(--muted) / 0.8)', backdropFilter: 'blur(8px)' }}
                  onClick={() => restoreSession(session.id)}
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">恢复正常</TooltipContent>
            </Tooltip>
          )}
          {isArchived && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500 hover:text-white disabled:pointer-events-none"
                  style={{ background: 'hsl(var(--muted) / 0.8)', backdropFilter: 'blur(8px)' }}
                  disabled={isPending}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">彻底删除</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-stretch gap-3 pr-9">
            {/* Agent avatar (rounded-xl, stretches to match title+branch height) + status badge */}
            {(() => {
              const ac = agentConfig[session.agentType] ?? agentConfig.shell
              const Icon = ac.Icon
              return (
                <div className="relative w-10 shrink-0">
                  <div
                    className="flex h-full w-full items-center justify-center rounded-xl"
                    style={{ background: ac.bg }}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[2px]"
                    style={{
                      background: color,
                      borderColor: 'hsl(var(--background))',
                      boxShadow: `0 0 5px ${color}`,
                    }}
                  >
                    {session.status === 'running' && (
                      <span
                        className="absolute inset-0 rounded-full animate-ping opacity-70"
                        style={{ background: color }}
                      />
                    )}
                  </span>
                </div>
              )
            })()}
            {/* Title + branch column */}
            <div className="flex min-w-0 flex-col justify-center">
              <span className="min-w-0 truncate text-[13px] font-bold tracking-tight" style={{ color: 'rgba(255,255,255,0.92)' }}>
                {session.name}
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <GitBranch className="h-3 w-3 shrink-0" style={{ color: `${color}99` }} />
                <span className="min-w-0 truncate font-mono text-[10px]" style={{ color: '#8b949e' }}>
                  {session.branchName}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Status + agent type pills */}
        <div className="flex items-center gap-1.5 px-4 pb-3">
          <Badge
            variant="outline"
            className={cn(
              session.status === 'waiting' && 'animate-pulse',
            )}
            style={{ background: `${color}18`, color, borderColor: `${color}35`, fontSize: '9px' }}
          >
            {session.status === 'waiting' && <Bell />}
            {cfg.label}
          </Badge>
          {session.collaborationRole && session.collaborationRole !== 'standalone' && (
            <Badge

              variant="outline"
              style={{ background: 'rgba(180,83,9,0.12)', color: '#d97706', borderColor: 'rgba(180,83,9,0.3)', fontSize: '9px' }}
            >
              {roleLabel[session.collaborationRole] ?? session.collaborationRole}
            </Badge>
          )}
          {session.agentType && (() => {
            const ac = agentConfig[session.agentType] ?? agentConfig.shell
            const Icon = ac.Icon
            return (
              <Badge
                variant="outline"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)', borderColor: 'rgba(255,255,255,0.14)', fontSize: '9px' }}
              >
                <Icon style={{ color: ac.bg }} />
                {session.agentType}
              </Badge>
            )
          })()}
        </div>

        {/* Luminous separator */}
        <div className="mx-4 mb-3 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Latest AI message */}
        <div className="mx-3 mb-4 overflow-hidden rounded-[12px]" style={{ background: '#0a0a0a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(255,255,255,0.04)' }}>
          <div
            className="px-3 py-3 text-[9px] leading-relaxed"
            style={{ color: '#8b949e', minHeight: '72px', maxHeight: '144px', overflow: 'hidden' }}
          >
            {session.lastAiMessage ? (
              <p className="whitespace-pre-wrap break-all">{truncateMessage(session.lastAiMessage, 320)}</p>
            ) : (
              <span style={{ color: '#484f58' }}>等待 AI 输出…</span>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog
          NOTE: React Portal events still bubble through the React tree.
          The wrapping div stops all pointer/click events from reaching
          ReactFlow's onNodeClick handler. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Dialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>彻底删除会话</DialogTitle>
              <DialogDescription>
                将删除 Worktree 目录（
                <span className="font-mono text-foreground">.agent-worktrees/{session.id}</span>
                ）和分支（
                <span className="font-mono text-foreground">{session.branchName}</span>
                ），此操作不可恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  deleteSession(session.id)
                  setDeleteOpen(false)
                }}
              >
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}

function areEqual(
  prev: NodeProps<SessionNodeType>,
  next: NodeProps<SessionNodeType>
): boolean {
  const p = prev.data.session
  const n = next.data.session
  return (
    p.id === n.id &&
    p.name === n.name &&
    p.status === n.status &&
    p.progress === n.progress &&
    p.branchName === n.branchName &&
    p.lastAiMessage === n.lastAiMessage &&
    p.collaborationRole === n.collaborationRole &&
    p.canvasPosition.x === n.canvasPosition.x &&
    p.canvasPosition.y === n.canvasPosition.y
  )
}

export const SessionNode = memo(SessionNodeInner, areEqual)
