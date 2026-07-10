import type { AgentType } from '@akari/shared-types'
import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Bot, Code2, Terminal, Sparkles } from 'lucide-react'
import { ClaudeIcon } from '@/components/icons/ClaudeIcon'
import { KimiIcon } from '@/components/icons/KimiIcon'

interface AgentTypeSelectProps {
  value: AgentType
  onValueChange: (value: AgentType) => void
  id?: string
}

const OPTIONS: { value: AgentType; label: string; icon: ReactNode }[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    icon: <ClaudeIcon className="h-3.5 w-3.5 shrink-0 text-[#D97757]" />,
  },
  {
    value: 'claude-orchestrator',
    label: 'Claude Orchestrator',
    icon: <Bot className="h-3.5 w-3.5 shrink-0 text-[#b45309]" />,
  },
  {
    value: 'aider',
    label: 'Aider',
    icon: <Code2 className="h-3.5 w-3.5 shrink-0 text-[#2563eb]" />,
  },
  {
    value: 'kimi',
    label: 'Kimi',
    icon: <KimiIcon className="h-3.5 w-3.5 shrink-0 text-[#1783FF]" />,
  },
  {
    value: 'shell',
    label: 'Shell（自定义）',
    icon: <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />,
  },
]

export function AgentTypeSelect({ value, onValueChange, id }: AgentTypeSelectProps) {
  const selected = OPTIONS.find(o => o.value === value) ?? OPTIONS[0]

  return (
    <Select value={value} onValueChange={v => onValueChange(v as AgentType)}>
      <SelectTrigger id={id} className="h-8 text-xs">
        <SelectValue placeholder="选择 Agent 类型">
          <span className="flex items-center gap-1.5">
            {selected.icon}
            {selected.label}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map(option => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
