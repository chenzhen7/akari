import { memo, useState, useEffect, useRef } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Circle, Archive, Trash2 } from 'lucide-react'
import type { AgentSession } from '@/types'
import { useSessionStore } from '@/stores/session-store'
import { terminalBus } from '@/lib/terminalBus'

type SessionNodeData = {
  session: AgentSession
}

type SessionNodeType = Node<SessionNodeData>

const statusColorMap: Record<string, string> = {
  running: 'text-green-500',
  waiting: 'text-amber-500',
  failed: 'text-red-500',
  completed: 'text-blue-500',
  initializing: 'text-slate-400',
  paused: 'text-orange-500',
  review: 'text-purple-500',
  archived: 'text-slate-400',
}

const statusLabelMap: Record<string, string> = {
  running: '运行中',
  waiting: '待审批',
  failed: '失败',
  completed: '已完成',
  initializing: '初始化中',
  paused: '已暂停',
  review: '审查中',
  archived: '已归档',
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

  const colorClass = statusColorMap[session.status] ?? 'text-slate-400'
  const borderColorClass = colorClass.replace('text-', 'border-')
  const isArchived = session.status === 'archived'

  function stopBubble(e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
  }

  return (
    <>
      <Card
        className={`relative w-[280px] cursor-pointer select-none border-2 ${borderColorClass} bg-card shadow-md transition-shadow hover:shadow-lg`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Hover action buttons */}
        {hovered && (
          <div
            className="absolute right-2 top-2 z-10 flex items-center gap-1"
            onClick={stopBubble}
            onMouseDown={stopBubble}
            onPointerDown={stopBubble}
            onPointerUp={stopBubble}
          >
            {!isArchived && (
              <button
                className="rounded bg-background/90 p-1 text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted hover:text-foreground"
                title="归档（终止进程，保留 Worktree）"
                onClick={() => archiveSession(session.id)}
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
            {isArchived && (
              <button
                className="rounded bg-background/90 p-1 text-destructive ring-1 ring-border transition-colors hover:bg-destructive hover:text-destructive-foreground"
                title="彻底删除"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <CardHeader className="flex flex-row items-center gap-2 p-3 pb-2">
          <Circle className={`h-3 w-3 shrink-0 fill-current ${colorClass}`} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{session.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {session.branchName}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-2 p-3 pt-0">
          <div className="text-xs">
            <span className={`font-medium ${colorClass}`}>
              {statusLabelMap[session.status] ?? session.status}
            </span>
          </div>

          {/* Mini terminal preview */}
          <div className="min-h-[28px] space-y-0.5 rounded bg-muted/50 p-1.5 font-mono text-[10px] text-muted-foreground">
            {miniTerminal.length > 0 ? (
              miniTerminal.map((line, i) => (
                <div key={i} className="truncate">{line}</div>
              ))
            ) : (
              <span className="opacity-40">等待输出...</span>
            )}
          </div>
        </CardContent>
      </Card>

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
