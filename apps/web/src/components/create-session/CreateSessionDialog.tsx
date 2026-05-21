import { useState } from 'react'
import type { AgentType } from '@akari/shared-types'
import {
  Dialog,
  DialogContent,
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
import { useSessionStore } from '@/stores/session-store'

export function CreateSessionDialog() {
  const { createDialogOpen, toggleCreateDialog, addSession } =
    useSessionStore()
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>新建会话</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">会话名称</label>
            <Input
              placeholder="例如：feat/user-auth"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">任务描述</label>
            <Textarea
              placeholder="描述 Agent 需要完成的任务..."
              value={task}
              onChange={e => setTask(e.target.value)}
              required
              className="min-h-[100px]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">基础分支</label>
            <Select value={baseBranch} onValueChange={setBaseBranch}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">main</SelectItem>
                <SelectItem value="develop">develop</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Agent 类型</label>
            <Select value={agentType} onValueChange={v => setAgentType(v as AgentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude Code</SelectItem>
                <SelectItem value="aider">Aider</SelectItem>
                <SelectItem value="shell">Shell (自定义)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={toggleCreateDialog}>
              取消
            </Button>
            <Button type="submit">创建</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
