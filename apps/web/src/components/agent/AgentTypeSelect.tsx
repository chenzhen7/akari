import type { AgentType } from '@akari/shared-types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AGENT_CONFIG, AGENT_TYPES } from '@/lib/agent-config'

interface AgentTypeSelectProps {
  value: AgentType
  onValueChange: (value: AgentType) => void
  id?: string
}

export function AgentTypeSelect({ value, onValueChange, id }: AgentTypeSelectProps) {
  const selected = AGENT_CONFIG[value] ?? AGENT_CONFIG.shell
  const SelectedIcon = selected.icon

  return (
    <Select value={value} onValueChange={v => onValueChange(v as AgentType)}>
      <SelectTrigger id={id} className="h-8 text-xs">
        <SelectValue placeholder="选择 Agent 类型">
          <span className="flex items-center gap-1.5">
            <SelectedIcon className="h-3.5 w-3.5 shrink-0" style={{ color: selected.color }} />
            {selected.displayName}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {AGENT_TYPES.map(type => {
          const cfg = AGENT_CONFIG[type]
          const Icon = cfg.icon
          return (
            <SelectItem key={type} value={type}>
              <span className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cfg.color }} />
                {cfg.displayName}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
