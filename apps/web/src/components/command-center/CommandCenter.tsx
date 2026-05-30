import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useSessionStore } from '@/stores/session-store'
import {
  Radio,
  Send,
  Check,
  X,
  Eye,
  Circle,
  Bot,
  Zap,
  CheckCircle2,
  XCircle,
  Archive,
} from 'lucide-react'

const STATUS_META: Record<string, {
  label: string
  icon: React.ElementType
  color: string
  bg: string
  dot: string
}> = {
  running: {
    label: 'Running',
    icon: Zap,
    color: 'text-green-500',
    bg: 'bg-green-500/10 text-green-500 border-green-500/30',
    dot: 'fill-green-500 text-green-500',
  },
  waiting: {
    label: 'Waiting',
    icon: Circle,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    dot: 'fill-amber-500 text-amber-500',
  },
  completed: {
    label: 'Done',
    icon: CheckCircle2,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    dot: 'fill-blue-500 text-blue-500',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-500/10 text-red-500 border-red-500/30',
    dot: 'fill-red-500 text-red-500',
  },
  initializing: {
    label: 'Initializing',
    icon: Bot,
    color: 'text-slate-400',
    bg: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
    dot: 'fill-slate-400 text-slate-400',
  },
  paused: {
    label: 'Paused',
    icon: Archive,
    color: 'text-orange-500',
    bg: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
    dot: 'fill-orange-500 text-orange-500',
  },
}

function SessionChip({
  id,
  name,
  status,
  selected,
  onToggle,
}: {
  id: string
  name: string
  status: string
  selected: boolean
  onToggle: () => void
}) {
  const meta = STATUS_META[status] ?? STATUS_META['initializing']
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`
        inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-all
        ${selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
        }
      `}
    >
      <Circle className={`h-2 w-2 ${meta.dot}`} />
      <span className="truncate max-w-[80px]">{name}</span>
    </button>
  )
}

function ApprovalCard({
  sessionId,
  name,
  status,
  pendingApproval,
  onApprove,
  onReject,
  onView,
  onClose,
}: {
  sessionId: string
  name: string
  status: string
  pendingApproval?: { command?: string; message?: string }
  onApprove: () => void
  onReject: () => void
  onView: () => void
  onClose: () => void
}) {
  const meta = STATUS_META[status] ?? STATUS_META['waiting']
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Circle className={`h-2.5 w-2.5 shrink-0 ${meta.dot}`} />
          <span className="truncate text-xs font-medium">{name}</span>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-green-500 hover:bg-green-500/15 hover:text-green-400"
            onClick={onApprove}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-red-500 hover:bg-red-500/15 hover:text-red-400"
            onClick={onReject}
          >
            <X className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:bg-muted"
            onClick={() => { onView(); onClose() }}
          >
            <Eye className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {pendingApproval?.command ? (
        <code className="block truncate rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-amber-300/90 border border-amber-500/15">
          {pendingApproval.command}
        </code>
      ) : (
        <p className="truncate text-[10px] text-muted-foreground pl-0.5">
          {pendingApproval?.message ?? '等待审批'}
        </p>
      )}
    </div>
  )
}

function StatCard({
  status,
  count,
  isAll = false,
}: {
  status: string
  count: number
  isAll?: boolean
}) {
  const meta = isAll ? {
    label: 'Total',
    color: 'text-foreground',
    bg: 'bg-muted',
    dot: '',
  } : (STATUS_META[status] ?? STATUS_META['initializing'])

  return (
    <div className={`flex flex-col items-center justify-center rounded-lg border px-2 py-2 ${isAll ? 'border-border bg-muted' : meta.bg}`}>
      <div className={`text-xl font-bold tabular-nums ${meta.color}`}>{count}</div>
      <div className={`text-[10px] font-medium uppercase tracking-wider ${isAll ? 'text-muted-foreground' : meta.color}`}>
        {meta.label}
      </div>
    </div>
  )
}

export function CommandCenter() {
  const {
    commandCenterOpen,
    toggleCommandCenter,
    sessions,
    approveSession,
    rejectSession,
    openTab,
    addTerminalLine,
  } = useSessionStore()

  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(
    new Set()
  )
  const [broadcasting, setBroadcasting] = useState(false)

  const waitingSessions = sessions.filter(s => s.status === 'waiting')

  const runningCount = sessions.filter(s => s.status === 'running').length
  const waitingCount = waitingSessions.length
  const doneCount = sessions.filter(s => s.status === 'completed').length
  const failedCount = sessions.filter(s => s.status === 'failed').length

  function toggleTarget(id: string) {
    setSelectedTargets(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedTargets(new Set())
  }

  async function sendBroadcast() {
    if (!broadcastMsg.trim()) return
    setBroadcasting(true)
    const targets =
      selectedTargets.size > 0 ? Array.from(selectedTargets) : undefined
    const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
    try {
      const res = await fetch(`${API_BASE}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMsg.trim(), targets }),
      })
      if (!res.ok) throw new Error('Broadcast failed')
    } catch {
      const ids = targets ?? sessions.map(s => s.id)
      ids.forEach(id => addTerminalLine(id, `[Broadcast] ${broadcastMsg}`))
    } finally {
      setBroadcasting(false)
      setBroadcastMsg('')
      setSelectedTargets(new Set())
    }
  }

  return (
    <Sheet open={commandCenterOpen} onOpenChange={toggleCommandCenter}>
      <SheetContent
        side="right"
        className="w-[480px] max-w-[480px] flex flex-col p-0 gap-0"
      >
        {/* Header */}
        <SheetHeader className="border-b border-border px-5 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Radio className="h-4 w-4 text-primary" />
            </div>
            <SheetTitle className="text-base font-semibold">指挥中心</SheetTitle>
            <Badge variant="outline" className="ml-auto text-[10px] h-5">
              {sessions.length} 会话
            </Badge>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 p-5">

            {/* ── 广播 ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-1 rounded-full bg-primary" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  广播消息
                </h3>
              </div>
              <Textarea
                placeholder="向选中的 Agent 发送指令或信息…"
                value={broadcastMsg}
                onChange={e => setBroadcastMsg(e.target.value)}
                className="min-h-[88px] resize-none text-sm"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    sendBroadcast()
                  }
                }}
              />
              <div>
                <p className="text-[10px] text-muted-foreground mb-2 font-medium">
                  目标会话
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={selectAll}
                    className={`
                      inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-all
                      ${selectedTargets.size === 0
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                      }
                    `}
                  >
                    全部
                  </button>
                  {sessions.map(s => (
                    <SessionChip
                      key={s.id}
                      id={s.id}
                      name={s.name}
                      status={s.status}
                      selected={selectedTargets.has(s.id)}
                      onToggle={() => toggleTarget(s.id)}
                    />
                  ))}
                </div>
              </div>
              <Button
                className="w-full gap-2"
                onClick={sendBroadcast}
                disabled={!broadcastMsg.trim() || broadcasting}
              >
                <Send className="h-3.5 w-3.5" />
                {broadcasting ? '发送中…' : '发送广播'}
                {broadcastMsg.trim() && (
                  <kbd className="ml-auto rounded border bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
                    ⌘↵
                  </kbd>
                )}
              </Button>
            </section>

            <Separator />

            {/* ── 待审批 ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-1 rounded-full bg-amber-500" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  待审批
                </h3>
                {waitingCount > 0 && (
                  <Badge variant="outline" className="ml-auto h-5 text-[10px] border-amber-500/40 text-amber-500">
                    {waitingCount}
                  </Badge>
                )}
              </div>
              {waitingSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 gap-2">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">暂无待审批项</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {waitingSessions.map(s => (
                    <ApprovalCard
                      key={s.id}
                      sessionId={s.id}
                      name={s.name}
                      status={s.status}
                      pendingApproval={s.pendingApproval}
                      onApprove={() => approveSession(s.id)}
                      onReject={() => rejectSession(s.id)}
                      onView={() => openTab(s.id)}
                      onClose={toggleCommandCenter}
                    />
                  ))}
                </div>
              )}
            </section>

            <Separator />

            {/* ── 全局概览 ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-1 rounded-full bg-blue-500" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  全局概览
                </h3>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <StatCard status="running" count={runningCount} />
                <StatCard status="waiting" count={waitingCount} />
                <StatCard status="completed" count={doneCount} />
                <StatCard status="failed" count={failedCount} />
                <StatCard status="" count={sessions.length} isAll />
              </div>
            </section>

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
