import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

interface EditorContainerProps {
  filePath: string
  loading: boolean
  error: string | null
  headerExtra?: ReactNode
  children: ReactNode
}

export function EditorContainer({ filePath, loading, error, headerExtra, children }: EditorContainerProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* File path + optional toolbar extras */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="truncate text-[11px] text-muted-foreground font-mono">{filePath}</span>
        {headerExtra}
      </div>

      {/* Monaco editor or status overlays */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {loading && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载文件内容...
          </div>
        )}
        {error && !loading && (
          <div className="flex h-full items-center justify-center p-4 text-sm text-red-400">
            加载失败: {error}
          </div>
        )}
        {!loading && !error && children}
      </div>
    </div>
  )
}
