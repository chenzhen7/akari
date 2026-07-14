import { useEffect, useState } from 'react'
import type { AgentType } from '@akari/shared-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Sparkles, Loader2 } from 'lucide-react'
import { AgentTypeSelect } from '@/components/agent/AgentTypeSelect'
import { useSessionStore } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { API_BASE } from '@/lib/api'
import { useWorkspaceStore } from '@/stores/workspace-store'

interface RepoBranch {
  name: string
  isCurrent: boolean
}

export function CreateSessionDialog() {
  const createDialogOpen = useUIStore(s => s.createDialogOpen)
  const closeCreateDialog = useUIStore(s => s.closeCreateDialog)
  const toggleCreateDialog = useUIStore(s => s.toggleCreateDialog)
  const addSession = useSessionStore(s => s.addSession)
  const mainSession = useSessionStore(s => s.sessions.find(s => s.isMain) ?? null)
  const currentWorkspace = useWorkspaceStore(s => s.currentWorkspace)
  const isGitWorkspace = currentWorkspace?.isGit !== false
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [agentType, setAgentType] = useState<AgentType>('claude')
  const [branches, setBranches] = useState<RepoBranch[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)

  useEffect(() => {
    if (!createDialogOpen) return
    if (!isGitWorkspace) {
      setBranches([])
      setBaseBranch('')
      setBranchesLoading(false)
      return
    }
    setBranchesLoading(true)
    fetch(`${API_BASE}/repo/branches`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as RepoBranch[]
        setBranches(data)
        // 默认以主会话的当前分支作为 baseBranch，否则使用仓库当前分支
        const defaultBranch = mainSession?.branchName ?? data.find(b => b.isCurrent)?.name ?? data[0]?.name ?? ''
        setBaseBranch(defaultBranch)
      })
      .catch(err => {
        console.error('[CreateSessionDialog] fetch branches failed:', err)
        // 降级：保留空列表，让用户可以手动输入
        setBranches([])
        setBaseBranch(mainSession?.branchName ?? '')
      })
      .finally(() => setBranchesLoading(false))
  }, [createDialogOpen, mainSession, isGitWorkspace])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isGitWorkspace) return
    if (!name.trim() || !task.trim() || !baseBranch.trim()) return
    addSession(name.trim(), task.trim(), baseBranch, agentType)
    closeCreateDialog()
    setName('')
    setTask('')
    setBaseBranch('')
    setAgentType('claude')
  }

  return (
    <Dialog open={createDialogOpen} onOpenChange={toggleCreateDialog}>
      <DialogContent className="sm:max-w-[460px] gap-0 p-0 overflow-hidden">

        {/* Header */}
        <DialogHeader className="flex-row items-center gap-3 px-5 pt-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-xl font-semibold">新建会话</DialogTitle>
          
          </div>
        </DialogHeader>

        {/* Body */}
        <form id="create-session-form" onSubmit={handleSubmit}>
          <FieldGroup className="px-5 py-4">

            {/* Name */}
            <Field>
              <FieldLabel htmlFor="session-name">会话名称</FieldLabel>
              <Input
                id="session-name"
                placeholder="feat/user-auth"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </Field>

            {/* Task */}
            <Field>
              <FieldLabel htmlFor="session-task">任务描述</FieldLabel>
              <Textarea
                id="session-task"
                placeholder="描述 Agent 需要完成的任务…"
                value={task}
                onChange={e => setTask(e.target.value)}
                required
                className="min-h-[80px] resize-none text-xs"
              />
            </Field>

            {/* Branch + Agent type */}
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="session-branch">基础分支</FieldLabel>
                {branchesLoading ? (
                  <div className="flex h-8 items-center gap-2 rounded-md border border-input px-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    加载分支…
                  </div>
                ) : branches.length > 0 ? (
                  <Select value={baseBranch} onValueChange={setBaseBranch}>
                    <SelectTrigger id="session-branch" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(b => (
                        <SelectItem key={b.name} value={b.name}>
                          <span className="break-all">{b.name}{b.isCurrent ? ' (当前)' : ''}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="session-branch"
                    placeholder="例如 main"
                    value={baseBranch}
                    onChange={e => setBaseBranch(e.target.value)}
                    className="h-8 text-xs"
                    required
                  />
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="session-agent">Agent 类型</FieldLabel>
                <AgentTypeSelect
                  id="session-agent"
                  value={agentType}
                  onValueChange={setAgentType}
                />
              </Field>
            </div>
          </FieldGroup>

          <div className="h-px bg-border" />

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-5 py-3">
            {!isGitWorkspace && (
              <span className="text-xs text-destructive">当前工作区不是 Git 仓库，无法创建会话</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" className="h-8 text-xs" onClick={toggleCreateDialog}>
                取消
              </Button>
              <Button type="submit" disabled={!isGitWorkspace} className="h-8 gap-1.5 text-xs">
                <Plus className="h-3.5 w-3.5" />
                创建会话
              </Button>
            </div>
          </div>
        </form>

      </DialogContent>
    </Dialog>
  )
}
