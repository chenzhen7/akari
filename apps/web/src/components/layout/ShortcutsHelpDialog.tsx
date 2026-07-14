import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useUIStore } from '@/stores/ui-store'
import { SHORTCUTS, GOTO_SESSION_HELP, formatComboLabel } from '@/lib/shortcuts'

interface HelpRow {
  label: string
  description: string
}

function buildGroups(): { group: string; rows: HelpRow[] }[] {
  const order: string[] = []
  const map = new Map<string, HelpRow[]>()

  const push = (group: string, row: HelpRow): void => {
    if (!map.has(group)) {
      map.set(group, [])
      order.push(group)
    }
    map.get(group)!.push(row)
  }

  for (const s of SHORTCUTS) {
    push(s.group, { label: formatComboLabel(s.combo), description: s.description })
  }
  push(GOTO_SESSION_HELP.group, { label: GOTO_SESSION_HELP.label, description: GOTO_SESSION_HELP.description })

  return order.map(group => ({ group, rows: map.get(group)! }))
}

const GROUPS = buildGroups()

function Kbd({ label }: { label: string }) {
  return (
    <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-sans text-muted-foreground shadow-sm">
      {label}
    </kbd>
  )
}

export function ShortcutsHelpDialog() {
  const open = useUIStore(s => s.shortcutsHelpOpen)
  const setOpen = useUIStore(s => s.setShortcutsHelpOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>常用功能的快捷键一览，终端内同样生效。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {GROUPS.map(({ group, rows }) => (
            <div key={group} className="space-y-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </h4>
              <div className="space-y-1">
                {rows.map(row => (
                  <div key={row.label} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-foreground">{row.description}</span>
                    <Kbd label={row.label} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
