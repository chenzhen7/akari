import { useState } from 'react'
import type { AgentType } from '@akari/shared-types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Plus, Sparkles } from 'lucide-react'
import { useSessionStore } from '@/stores/session-store'

export function CreateSessionDialog() {
  const { createDialogOpen, toggleCreateDialog, addSession } = useSessionStore()
  const [name, setName] = useState('')
  const [task, setTask] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')
  const [agentType, setAgentType] = useState<AgentType>('claude')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !task.trim()) return
    addSession(name.trim(), task.trim(), baseBranch, agentType)
    setName('')
    setTask('')
    setBaseBranch('main')
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
                <Select value={baseBranch} onValueChange={setBaseBranch}>
                  <SelectTrigger id="session-branch" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">main</SelectItem>
                    <SelectItem value="develop">develop</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="session-agent">Agent 类型</FieldLabel>
                <Select value={agentType} onValueChange={v => setAgentType(v as AgentType)}>
                  <SelectTrigger id="session-agent" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude Code</SelectItem>
                    <SelectItem value="claude-orchestrator">Claude Orchestrator</SelectItem>
                    <SelectItem value="aider">Aider</SelectItem>
                    <SelectItem value="shell">Shell（自定义）</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </FieldGroup>

          <div className="h-px bg-border" />

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3">
            <Button type="button" variant="ghost" className="h-8 text-xs" onClick={toggleCreateDialog}>
              取消
            </Button>
            <Button type="submit"  className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              创建会话
            </Button>
          </div>
        </form>

      </DialogContent>
    </Dialog>
  )
}
