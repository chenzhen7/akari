import { useEffect, useRef } from 'react'
import { GitBranch, GitFork } from 'lucide-react'
import type { GitCommit } from '@akari/shared-types'
import { cn } from '@/lib/utils'

interface GitContextMenuProps {
  commit: GitCommit
  x: number
  y: number
  hasBranch: boolean
  onClose: () => void
  onCheckout: (hash: string) => void
  onCreateBranch: (hash: string) => void
}

interface MenuItem {
  icon: React.ElementType
  label: string
  action: () => void
  show?: boolean
  className?: string
}

export function GitContextMenu({
  commit,
  x,
  y,
  hasBranch,
  onClose,
  onCheckout,
  onCreateBranch,
}: GitContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const items: MenuItem[] = [
    {
      icon: GitBranch,
      label: '切换到此分支',
      action: () => { onCheckout(commit.hash); onClose() },
      show: hasBranch,
    },
    {
      icon: GitFork,
      label: '从此提交新建分支',
      action: () => { onCreateBranch(commit.hash); onClose() },
      show: true,
    },
  ]

  const visibleItems = items.filter(i => i.show !== false)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <div className="px-2 pb-1 pt-0.5 text-[10px] font-mono text-muted-foreground border-b border-border mb-1">
        {commit.shortHash}
      </div>
      {visibleItems.map((item, i) => (
        <button
          key={i}
          onClick={item.action}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
            item.className,
          )}
        >
          <item.icon className="h-3.5 w-3.5 shrink-0" />
          {item.label}
        </button>
      ))}
    </div>
  )
}
