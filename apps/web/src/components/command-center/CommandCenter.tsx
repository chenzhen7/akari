import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useSessionStore } from '@/stores/session-store'
import { Check, X, Eye } from 'lucide-react'

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

  function sendBroadcast() {
    if (!broadcastMsg.trim()) return
    const targets =
      selectedTargets.size > 0 ? Array.from(selectedTargets) : undefined
    const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
    fetch(`${API_BASE}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: broadcastMsg.trim(), targets }),
    }).catch(() => {
      const ids = targets ?? sessions.map(s => s.id)
      ids.forEach(id => addTerminalLine(id, `[Broadcast] ${broadcastMsg}`))
    })
    setBroadcastMsg('')
    setSelectedTargets(new Set())
  }

  return (
    <Sheet open={commandCenterOpen} onOpenChange={toggleCommandCenter}>
      <SheetContent className="w-[400px] sm:max-w-[400px]">
        <SheetHeader>
          <SheetTitle>指挥中心</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          {/* Broadcast */}
          <div className="space-y-2">
            <Field>
              <FieldLabel htmlFor="broadcast-msg">广播消息</FieldLabel>
              <Textarea
                id="broadcast-msg"
                placeholder="输入要广播给所有 Agent 的消息..."
                value={broadcastMsg}
                onChange={e => setBroadcastMsg(e.target.value)}
                className="min-h-[80px] text-sm"
              />
            </Field>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="broadcast-all"
                  checked={selectedTargets.size === 0}
                  onChange={() => setSelectedTargets(new Set())}
                  className="h-4 w-4"
                />
                <label htmlFor="broadcast-all" className="text-xs">
                  全部
                </label>
              </div>
              {sessions.map(s => (
                <div key={s.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`target-${s.id}`}
                    checked={selectedTargets.has(s.id)}
                    onChange={() => toggleTarget(s.id)}
                    className="h-4 w-4"
                  />
                  <label htmlFor={`target-${s.id}`} className="text-xs">
                    {s.name}
                  </label>
                </div>
              ))}
            </div>
            <Button size="sm" className="w-full" onClick={sendBroadcast}>
              发送广播
            </Button>
          </div>

          <Separator />

          {/* Pending approvals */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">待审批队列</h4>
              <span className="text-xs text-muted-foreground">
                {waitingCount} 个
              </span>
            </div>
            {waitingSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无待审批项</p>
            ) : (
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {waitingSessions.map(s => (
                    <div
                      key={s.id}
                      className="space-y-1 rounded-md border border-border p-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{s.name}</span>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => approveSession(s.id)}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => rejectSession(s.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5"
                            onClick={() => openTab(s.id)}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {s.task}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <Separator />

          {/* Stats */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">全局概览</h4>
            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-bold text-green-500">
                  {runningCount}
                </div>
                <div className="text-[10px] text-muted-foreground">Running</div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-bold text-amber-500">
                  {waitingCount}
                </div>
                <div className="text-[10px] text-muted-foreground">Waiting</div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-bold text-blue-500">{doneCount}</div>
                <div className="text-[10px] text-muted-foreground">Done</div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-bold text-red-500">
                  {failedCount}
                </div>
                <div className="text-[10px] text-muted-foreground">Failed</div>
              </div>
              <div className="rounded-md bg-muted p-2">
                <div className="text-lg font-bold">{sessions.length}</div>
                <div className="text-[10px] text-muted-foreground">Total</div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
