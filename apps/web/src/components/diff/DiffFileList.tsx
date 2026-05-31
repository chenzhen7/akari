import type { AgentSession, DiffFile } from '@akari/shared-types'
import { cn } from '@/lib/utils'

function statusColor(s: DiffFile['status']) {
  return s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : s === 'R' ? 'text-blue-400' : 'text-amber-400'
}

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.replace(/\\/g, '/').split('/')
  const name = parts.pop() ?? filePath
  const dir = parts.join('/')
  return { dir, name }
}

interface DiffFileListProps {
  session: AgentSession
  selectedFile: string | null
  onSelectFile: (path: string) => void
}

export function DiffFileList({ session, selectedFile, onSelectFile }: DiffFileListProps) {
  const diffFiles = session.diffFiles ?? []

  if (diffFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        暂无变更
      </div>
    )
  }

  const totalAdditions = diffFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = diffFiles.reduce((s, f) => s + f.deletions, 0)

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">变更文件</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
          {diffFiles.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5 font-mono text-[10px]">
          {totalAdditions > 0 && (
            <span className="text-green-500">+{totalAdditions}</span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-400">-{totalDeletions}</span>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {diffFiles.map(f => {
          const { dir, name } = splitPath(f.path)
          const isSelected = selectedFile === f.path
          const hasAdd = f.additions > 0
          const hasDel = f.deletions > 0
          return (
            <button
              key={f.path}
              onClick={() => onSelectFile(f.path)}
              className={cn(
                'flex w-full items-center gap-1.5 py-1 pl-1.5 pr-2 text-left transition-colors',
                isSelected
                  ? 'border-l-2 border-primary bg-accent/40'
                  : 'border-l-2 border-transparent hover:bg-muted/50',
              )}
            >
              <span className={cn('w-3.5 shrink-0 text-center text-[10px] font-bold leading-none', statusColor(f.status))}>
                {f.status}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] leading-tight text-foreground">{name}</div>
                {dir && (
                  <div className="mt-0.5 truncate text-[10px] leading-none text-muted-foreground/70">{dir}</div>
                )}
              </div>
              {(hasAdd || hasDel) && (
                <div className="shrink-0 font-mono text-[10px] leading-none">
                  {hasAdd && <span className="text-green-500">+{f.additions}</span>}
                  {hasAdd && hasDel && <span className="text-muted-foreground/50"> </span>}
                  {hasDel && <span className="text-red-400">-{f.deletions}</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
