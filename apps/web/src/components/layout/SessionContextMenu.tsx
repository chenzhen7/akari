import { useEffect, useRef } from 'react'
import { GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SessionContextMenuProps {
  x: number
  y: number
  sessionId: string
  currentBranch: string
  onClose: () => void
}

export function SessionContextMenu({
  x,
  y,
  sessionId,
  currentBranch,
  onClose,
}: SessionContextMenuProps) {
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

  const handleCheckout = () => {
    const branch = window.prompt('输入要 checkout 的分支名:', currentBranch)
    if (!branch || branch === currentBranch) {
      onClose()
      return
    }
    fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: branch.trim() }),
    }).catch(err => console.error('[checkout] failed:', err))
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <div className="px-2 pb-1 pt-0.5 text-[10px] font-mono text-muted-foreground border-b border-border mb-1">
        {currentBranch}
      </div>
      <button
        onClick={handleCheckout}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        切换分支
      </button>
    </div>
  )
}
