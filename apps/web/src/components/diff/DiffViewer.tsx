import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { DiffFile } from '@akari/shared-types'

const MonacoEditor = lazy(() => import('@monaco-editor/react'))

interface DiffViewerProps {
  diffFull?: string
  diffFiles?: DiffFile[]
  height?: string
}

export function DiffViewer({ diffFull, diffFiles, height = '100%' }: DiffViewerProps) {
  if (!diffFull && (!diffFiles || diffFiles.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无变更
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {diffFiles && diffFiles.length > 0 && (
        <div className="shrink-0 space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {diffFiles.map(f => (
            <div key={f.path} className="flex items-center gap-2 text-xs font-mono">
              <span
                className={
                  f.status === 'A'
                    ? 'text-green-500'
                    : f.status === 'D'
                      ? 'text-red-500'
                      : f.status === 'R'
                        ? 'text-blue-500'
                        : 'text-amber-500'
                }
              >
                {f.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">{f.path}</span>
              <span className="shrink-0 text-green-500">+{f.additions}</span>
              <span className="shrink-0 text-red-500">-{f.deletions}</span>
            </div>
          ))}
        </div>
      )}

      {diffFull && (
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载编辑器...
              </div>
            }
          >
            <MonacoEditor
              height={height}
              language="diff"
              value={diffFull}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'off',
                fontSize: 12,
                lineNumbers: 'off',
                folding: false,
                renderLineHighlight: 'none',
                padding: { top: 8, bottom: 8 },
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
