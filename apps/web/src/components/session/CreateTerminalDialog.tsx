import { useState } from 'react'
import type { AgentType } from '@akari/shared-types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Plus } from 'lucide-react'
import { AgentTypeSelect } from '@/components/agent/AgentTypeSelect'
import { useSessionStore } from '@/stores/session-store'

interface CreateTerminalDialogProps {
  sessionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateTerminalDialog({ sessionId, open, onOpenChange }: CreateTerminalDialogProps) {
  const createTerminal = useSessionStore(s => s.createTerminal)
  const [agentType, setAgentType] = useState<AgentType>('claude')
  const [bypassPermissions, setBypassPermissions] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createTerminal(sessionId, agentType, bypassPermissions)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[360px] gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-xl font-semibold">新建终端</DialogTitle>
        </DialogHeader>

        <form id="create-terminal-form" onSubmit={handleSubmit}>
          <FieldGroup className="px-5 py-4 gap-4">
            <Field>
              <FieldLabel htmlFor="terminal-agent">Agent 类型</FieldLabel>
              <AgentTypeSelect
                id="terminal-agent"
                value={agentType}
                onValueChange={v => {
                  setAgentType(v)
                  if (v !== 'claude') setBypassPermissions(false)
                }}
              />
            </Field>

            {agentType === 'claude' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bypass-permissions"
                  checked={bypassPermissions}
                  onCheckedChange={checked => setBypassPermissions(checked === true)}
                />
                <label
                  htmlFor="bypass-permissions"
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  以最高权限启动（--permission-mode bypassPermissions）
                </label>
              </div>
            )}
          </FieldGroup>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-end gap-2 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" className="h-8 gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              创建终端
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
