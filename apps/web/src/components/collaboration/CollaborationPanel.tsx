import { useState } from 'react'
import { useSessionStore } from '@/stores/session-store'
import type { CollaborationGroup } from '@akari/shared-types'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Network, Trash2, ArrowRight, Save, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

const TRIGGER_LABEL: Record<string, string> = {
  'on-complete': '完成时触发',
  'on-approval': '审批触发',
}

interface CollaborationPanelProps {
  open: boolean
  onClose: () => void
}

function GroupCard({ group }: { group: CollaborationGroup }) {
  const sessions = useSessionStore(s => s.sessions)
  const fetchGroups = useSessionStore(s => s.fetchGroups)
  const [context, setContext] = useState(group.sharedContext)
  const [saving, setSaving] = useState(false)

  async function handleSaveContext() {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/collaboration/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedContext: context }),
      })
      toast.success('共享上下文已保存')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteEdge(edgeId: string) {
    try {
      await fetch(`${API_BASE}/collaboration/groups/${group.id}/edges/${edgeId}`, {
        method: 'DELETE',
      })
      fetchGroups()
      toast.success('Pipeline 边已删除')
    } catch {
      toast.error('删除失败')
    }
  }

  async function handleDeleteGroup() {
    try {
      await fetch(`${API_BASE}/collaboration/groups/${group.id}`, { method: 'DELETE' })
      fetchGroups()
      toast.success('协作组已删除')
    } catch {
      toast.error('删除失败')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{group.name}</span>
            <Badge
              variant="outline"
              className={`text-[10px] h-4 ${
                group.status === 'active' ? 'border-green-500 text-green-600' :
                group.status === 'completed' ? 'border-blue-500 text-blue-600' :
                'border-red-500 text-red-600'
              }`}
            >
              {group.status}
            </Badge>
          </div>
          {group.description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{group.description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={handleDeleteGroup}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Sessions */}
      {group.sessionIds.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            成员 ({group.sessionIds.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.sessionIds.map(sid => {
              const s = sessions.find(x => x.id === sid)
              return (
                <Badge key={sid} variant="secondary" className="text-[10px] h-5 font-normal">
                  {s?.name ?? sid.slice(0, 8)}
                </Badge>
              )
            })}
          </div>
        </div>
      )}

      {/* Pipeline edges */}
      {group.pipelineEdges.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Pipeline ({group.pipelineEdges.length})
          </p>
          <div className="space-y-1.5">
            {group.pipelineEdges.map(edge => {
              const from = sessions.find(s => s.id === edge.fromSessionId)
              const to = sessions.find(s => s.id === edge.toSessionId)
              return (
                <div key={edge.id} className="flex items-center gap-1.5 text-xs">
                  <span className="truncate max-w-[80px] text-muted-foreground" title={edge.fromSessionId}>
                    {from?.name ?? edge.fromSessionId.slice(0, 6)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-indigo-500 shrink-0" />
                  <span className="truncate max-w-[80px] text-muted-foreground" title={edge.toSessionId}>
                    {to?.name ?? edge.toSessionId.slice(0, 6)}
                  </span>
                  <Badge variant="outline" className="text-[9px] h-4 ml-auto shrink-0">
                    {TRIGGER_LABEL[edge.trigger] ?? edge.trigger}
                  </Badge>
                  {edge.injectContext && (
                    <Badge variant="outline" className="text-[9px] h-4 border-indigo-400 text-indigo-500 shrink-0">
                      注入
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteEdge(edge.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Shared context */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
          共享上下文
        </p>
        <Textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          className="min-h-[60px] resize-none text-xs"
          placeholder="在此输入共享给所有成员的上下文…"
        />
        {context !== group.sharedContext && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-1.5 h-6 gap-1 text-xs"
            onClick={handleSaveContext}
            disabled={saving}
          >
            <Save className="h-3 w-3" />
            {saving ? '保存中…' : '保存'}
          </Button>
        )}
      </div>
    </div>
  )
}

export function CollaborationPanel({ open, onClose }: CollaborationPanelProps) {
  const groups = useSessionStore(s => s.groups)
  const fetchGroups = useSessionStore(s => s.fetchGroups)

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] flex flex-col p-0 gap-0">
        <SheetHeader className="flex-row items-center gap-2 border-b border-border px-4 py-3 shrink-0">
          <Network className="h-4 w-4 text-primary" />
          <SheetTitle className="text-sm font-semibold flex-1">多 Agent 协作</SheetTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground"
            onClick={() => fetchGroups()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Network className="h-10 w-10 text-muted-foreground/30" />
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">暂无协作组</p>
                <p className="text-xs text-muted-foreground/70">
                  在画布上拖拽连接两个 Session 节点<br />即可自动创建 Pipeline 协作组
                </p>
              </div>
            </div>
          ) : (
            <Accordion type="multiple" defaultValue={groups.map(g => g.id)}>
              {groups.map(group => (
                <AccordionItem key={group.id} value={group.id} className="border-none">
                  <AccordionTrigger className="py-1.5 text-xs hover:no-underline">
                    <span className="font-medium">{group.name}</span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-2">
                    <GroupCard group={group} />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 shrink-0">
          <p className="text-[10px] text-muted-foreground">
            提示：在画布中拖拽 Session 节点之间的连线可创建 Pipeline 关系。Orchestrator Agent 可通过{' '}
            <code className="font-mono">[SPAWN_AGENT]</code> 标记动态派生子 Agent。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
