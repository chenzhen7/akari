import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { destroyTerminalInstance } from './terminal-instances'
import type { SessionTab } from '@akari/shared-types'
import { useTabStore } from '@/features/session/stores/tab-store'

interface TabContextMenuProps {
  sessionId: string
  tab: SessionTab
  tabs: SessionTab[]
  x: number
  y: number
  onClose: () => void
}

interface MenuItemProps {
  label: string
  disabled?: boolean
  onClick: () => void
}

function MenuItem({ label, disabled, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <X className="h-3.5 w-3.5 shrink-0 opacity-0" />
      {label}
    </button>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-border" />
}

function destroyTerminalIfNeeded(tab: SessionTab): void {
  if ((tab.type === 'terminal' || tab.type === 'agent') && tab.terminalId) {
    destroyTerminalInstance(tab.terminalId)
  }
}

function isBatchClosable(tab: SessionTab): boolean {
  return tab.type !== 'terminal' && tab.type !== 'agent'
}

export function TabContextMenu({ sessionId, tab, tabs, x, y, onClose }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTab = useTabStore(s => s.closeTab)
  const tabIndex = tabs.findIndex(t => t.id === tab.id)

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleMouse)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleMouse)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const handleClose = () => {
    destroyTerminalIfNeeded(tab)
    closeTab(sessionId, tab.id)
    onClose()
  }

  const handleCloseOthers = () => {
    tabs
      .filter(t => t.id !== tab.id && isBatchClosable(t))
      .forEach(t => {
        closeTab(sessionId, t.id)
      })
    onClose()
  }

  const handleCloseToTheRight = () => {
    if (tabIndex === -1) return
    tabs
      .slice(tabIndex + 1)
      .filter(isBatchClosable)
      .forEach(t => {
        closeTab(sessionId, t.id)
      })
    onClose()
  }

  const handleCloseAll = () => {
    tabs
      .filter(isBatchClosable)
      .forEach(t => {
        closeTab(sessionId, t.id)
      })
    onClose()
  }

  const otherClosableCount = tabs.filter(t => t.id !== tab.id && isBatchClosable(t)).length
  const rightClosableCount = tabIndex === -1 ? 0 : tabs.slice(tabIndex + 1).filter(isBatchClosable).length
  const allClosableCount = tabs.filter(isBatchClosable).length

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <MenuItem label="关闭" onClick={handleClose} />
      <MenuItem
        label="关闭其他"
        disabled={otherClosableCount === 0}
        onClick={handleCloseOthers}
      />
      <MenuItem
        label="关闭右侧"
        disabled={rightClosableCount === 0}
        onClick={handleCloseToTheRight}
      />
      <MenuDivider />
      <MenuItem
        label="关闭全部"
        disabled={allClosableCount === 0}
        onClick={handleCloseAll}
      />
    </div>
  )
}
