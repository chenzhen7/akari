import { memo, useState, useEffect, useRef } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GitBranch, Archive, Trash2 } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { terminalBus } from '@/lib/terminalBus'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type SessionNodeData = {
  session: AgentSession
}

type SessionNodeType = Node<SessionNodeData>

const statusConfig: Record<string, { color: string; label: string }> = {
  running:      { color: '#22c55e', label: '运行中'   },
  waiting:      { color: '#f59e0b', label: '待审批'   },
  failed:       { color: '#ef4444', label: '失败'     },
  completed:    { color: '#3b82f6', label: '已完成'   },
  initializing: { color: '#94a3b8', label: '初始化中' },
  paused:       { color: '#f97316', label: '已暂停'   },
  review:       { color: '#a855f7', label: '审查中'   },
  archived:     { color: '#64748b', label: '已归档'   },
}

// Strip ANSI escape codes for mini-terminal preview
const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[mGKHF]/g, '').replace(/[\x00-\x09\x0b-\x1f]/g, '')

function SessionNodeInner({ data }: NodeProps<SessionNodeType>) {
  const session = data.session
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const [hovered, setHovered] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [miniTerminal, setMiniTerminal] = useState<string[]>(() =>
    terminalBus.getBuffer(session.id)
      .slice(-3).map(stripAnsi).filter(l => l.trim()).slice(-2)
  )

  useEffect(() => {
    const refresh = () => {
      setMiniTerminal(
        terminalBus.getBuffer(session.id)
          .slice(-3).map(stripAnsi).filter(l => l.trim()).slice(-2)
      )
    }
    return terminalBus.on(session.id, () => {
      if (!pendingRef.current) {
        pendingRef.current = setTimeout(() => {
          pendingRef.current = null
          refresh()
        }, 500)
      }
    })
  }, [session.id])

  const cfg = statusConfig[session.status] ?? statusConfig.initializing
  const isArchived = session.status === 'archived'
  const color = cfg.color

  function stopBubble(e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
  }

  return (
    <>
      <div
        className="relative w-[268px] cursor-pointer select-none overflow-hidden rounded-2xl transition-all duration-200"
        style={{
          background: 'linear-gradient(145deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)',
          border: `1px solid ${color}30`,
          boxShadow: hovered
            ? `0 0 0 1px ${color}50, 0 8px 32px ${color}25, 0 2px 8px rgba(0,0,0,0.4)`
            : `0 0 0 1px ${color}18, 0 4px 16px ${color}10, 0 2px 8px rgba(0,0,0,0.25)`,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Subtle inner glow at top */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-16 opacity-10"
          style={{ background: `radial-gradient(ellipse at 50% -20%, ${color}, transparent 70%)` }}
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
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  style={{ background: 'hsl(var(--muted) / 0.8)', backdropFilter: 'blur(8px)' }}
                  onClick={() => archiveSession(session.id)}
                >
                  <Archive className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">归档（终止进程，保留 Worktree）</TooltipContent>
            </Tooltip>
          )}
          {isArchived && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-500 hover:text-white"
                  style={{ background: 'hsl(var(--muted) / 0.8)', backdropFilter: 'blur(8px)' }}
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
        <div className="px-3.5 pt-3 pb-2">
          <div className="flex items-center gap-2.5 pr-9">
            {/* Status glow dot */}
            <span
              className="relative mt-px h-2 w-2 shrink-0 rounded-full"
              style={{ background: color, boxShadow: `0 0 6px ${color}` }}
            >
              {session.status === 'running' && (
                <span
                  className="absolute inset-0 rounded-full animate-ping opacity-60"
                  style={{ background: color }}
                />
              )}
            </span>
            <span className="min-w-0 truncate text-[13px] font-bold tracking-tight text-foreground">
              {session.name}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 pl-[18px]">
            <GitBranch className="h-3 w-3 shrink-0" style={{ color: `${color}99` }} />
            <span className="min-w-0 truncate font-mono text-[10px]" style={{ color: '#8b949e' }}>
              {session.branchName}
            </span>
          </div>
        </div>

        {/* Status + agent type pills */}
        <div className="flex items-center gap-1.5 px-3.5 pb-2.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}
          >
            {cfg.label}
          </span>
          {session.agentType && (
            <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
              {session.agentType}
            </span>
          )}
        </div>

        {/* Mini terminal */}
        <div className="mx-2.5 mb-3 overflow-hidden rounded-xl" style={{ background: '#0d1117' }}>
          {/* Terminal title bar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ background: '#161b22' }}>
            <span className="h-2 w-2 rounded-full" style={{ background: '#ff5f57' }} />
            <span className="h-2 w-2 rounded-full" style={{ background: '#febc2e' }} />
            <span className="h-2 w-2 rounded-full" style={{ background: '#28c840' }} />
            <span className="ml-auto font-mono text-[9px]" style={{ color: '#484f58' }}>
              {session.id.slice(0, 8)}
            </span>
          </div>
          <div
            className="min-h-[32px] px-3 py-2 font-mono text-[10px] leading-relaxed"
            style={{ color: '#8b949e' }}
          >
            {miniTerminal.length > 0 ? (
              miniTerminal.map((line, i) => (
                <div key={i} className="truncate">{line}</div>
              ))
            ) : (
              <span style={{ color: '#484f58' }}>等待输出…</span>
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
    p.canvasPosition.x === n.canvasPosition.x &&
    p.canvasPosition.y === n.canvasPosition.y
  )
}

export const SessionNode = memo(SessionNodeInner, areEqual)
