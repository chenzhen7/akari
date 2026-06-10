import { useEffect, useRef } from 'react'
import type { GitCommit } from '@akari/shared-types'

interface GitContextMenuProps {
  commit: GitCommit
  x: number
  y: number
  hasBranch: boolean
  onClose: () => void
  onCheckout: (hash: string) => void
  onCreateBranch: (hash: string) => void
}

export function GitContextMenu({
  commit,
  x,
  y,
  hasBranch: _hasBranch,
  onClose,
  onCheckout,
  onCreateBranch,
}: GitContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const items = [
    { label: 'Checkout', onClick: () => { onCheckout(commit.hash); onClose() } },
    { label: '新建分支', onClick: () => { onCreateBranch(commit.hash); onClose() } },
  ]

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className="flex w-full items-center px-3 py-1.5 text-xs text-popover-foreground hover:bg-accent"
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
