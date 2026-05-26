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
import { GitBranch, Archive, Trash2, Bot, Code2, Terminal, Bell } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { terminalBus } from '@/lib/terminalBus'
import { getTerminalViewportLines } from '@/components/session/TerminalPanel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type SessionNodeData = {
  session: AgentSession
}

type SessionNodeType = Node<SessionNodeData>

const agentConfig: Record<string, { bg: string; Icon: LucideIcon }> = {
  claude: { bg: '#7c3aed', Icon: Bot },
  aider:  { bg: '#2563eb', Icon: Code2 },
  shell:  { bg: '#374151', Icon: Terminal },
}

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

function getDisplayLines(sessionId: string, maxLines: number): string[] {
  // Primary: read directly from xterm's rendered viewport (accurate, same as real terminal)
  const vtLines = getTerminalViewportLines(sessionId, maxLines)
  if (vtLines.length > 0) return vtLines
  // Fallback: parse raw PTY buffer (before detail panel is ever opened)
  const chunks = terminalBus.getBuffer(sessionId)
  if (chunks.length === 0) return []
  const raw = chunks.join('')
  const lastClear = raw.lastIndexOf('\x1b[2J')
  const text = lastClear >= 0 ? raw.slice(lastClear) : raw
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(l => l.trim())
    .slice(-maxLines)
}

function SessionNodeInner({ data }: NodeProps<SessionNodeType>) {
  const session = data.session
  const archiveSession = useSessionStore(s => s.archiveSession)
  const deleteSession = useSessionStore(s => s.deleteSession)
  const [hovered, setHovered] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [miniTerminal, setMiniTerminal] = useState<string[]>(() => getDisplayLines(session.id, 5))

  useEffect(() => {
    const refresh = () => {
      setMiniTerminal(getDisplayLines(session.id, 5))
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
              <span className="min-w-0 truncate text-[13px] font-bold tracking-tight text-foreground">
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
              'h-auto py-0.5 text-[10px] font-semibold',
              session.status === 'waiting' && 'animate-pulse',
            )}
            style={{ background: `${color}18`, color, borderColor: `${color}35` }}
          >
            {session.status === 'waiting' && <Bell />}
            {cfg.label}
          </Badge>
          {session.agentType && (() => {
            const ac = agentConfig[session.agentType] ?? agentConfig.shell
            const Icon = ac.Icon
            return (
              <Badge variant="outline" className="h-auto py-0.5 text-[10px]">
                <Icon style={{ color: ac.bg }} />
                {session.agentType}
              </Badge>
            )
          })()}
        </div>

        {/* Mini terminal */}
        <div className="mx-3 mb-4 overflow-hidden rounded-xl" style={{ background: '#0d1117' }}>
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
            className="min-h-[72px] px-3 py-2 font-mono text-[8px] leading-relaxed"
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
