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
          <div className="flex flex-col gap-4 px-5 py-4">

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground">会话名称</label>
              <Input
                placeholder="feat/user-auth"
                value={name}
                onChange={e => setName(e.target.value)}
                required
             
              />
            </div>

            {/* Task */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">任务描述</label>
              <Textarea
                placeholder="描述 Agent 需要完成的任务…"
                value={task}
                onChange={e => setTask(e.target.value)}
                required
                className="min-h-[80px] resize-none text-xs"
              />
            </div>

            {/* Branch + Agent type */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">基础分支</label>
                <Select value={baseBranch} onValueChange={setBaseBranch}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">main</SelectItem>
                    <SelectItem value="develop">develop</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-foreground">Agent 类型</label>
                <Select value={agentType} onValueChange={v => setAgentType(v as AgentType)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude Code</SelectItem>
                    <SelectItem value="aider">Aider</SelectItem>
                    <SelectItem value="shell">Shell（自定义）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3">
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={toggleCreateDialog}>
              取消
            </Button>
            <Button type="submit" size="sm" className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              创建会话
            </Button>
          </div>
        </form>

      </DialogContent>
    </Dialog>
  )
}
