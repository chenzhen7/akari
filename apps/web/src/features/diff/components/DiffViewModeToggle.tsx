import { Columns2, LayoutTemplate } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'

export type DiffViewMode = 'split' | 'unified'

interface DiffViewModeToggleProps {
  mode: DiffViewMode
  onChange: (mode: DiffViewMode) => void
}

const MODES: { value: DiffViewMode; label: string; icon: typeof Columns2 }[] = [
  { value: 'split', label: 'Split', icon: Columns2 },
  { value: 'unified', label: 'Unified', icon: LayoutTemplate },
]

export function DiffViewModeToggle({ mode, onChange }: DiffViewModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5">
      {MODES.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          size="icon-xs"
          variant={mode === value ? 'secondary' : 'ghost'}
          className={cn('h-6 gap-1 px-2 text-[10px]', mode === value && 'bg-background shadow-sm')}
          onClick={() => onChange(value)}
          title={label}
        >
          <Icon className="h-3 w-3" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      ))}
    </div>
  )
}
