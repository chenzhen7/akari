import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { PlusCircle, Maximize2 } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'

interface CanvasContextMenuProps {
  x: number
  y: number
  flowPosition: { x: number; y: number }
  onClose: () => void
}

export function CanvasContextMenu({ x, y, flowPosition, onClose }: CanvasContextMenuProps) {
  const openCreateDialog = useUIStore(s => s.openCreateDialog)
  const { fitView } = useReactFlow()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  function handleItem(action: () => void) {
    action()
    onClose()
  }

  return (
    <div
      ref={ref}
      style={{ left: x, top: y }}
      className="absolute z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover shadow-md"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="p-1">
        <button
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => handleItem(() => openCreateDialog(flowPosition))}
        >
          <PlusCircle className="h-4 w-4" />
          新建会话
        </button>
        <div className="-mx-1 my-1 h-px bg-border" />
        <button
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => handleItem(() => fitView({ padding: 0.2, duration: 300 }))}
        >
          <Maximize2 className="h-4 w-4" />
          适应视图
        </button>
      </div>
    </div>
  )
}
