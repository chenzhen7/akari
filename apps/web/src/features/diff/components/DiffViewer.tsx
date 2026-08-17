import { useState, useEffect, memo, useRef, useCallback } from 'react'
import { DiffEditor as MonacoDiffEditor } from '@monaco-editor/react'
import type { DiffFile } from '@akari/shared-types'
import type { editor } from 'monaco-editor'
import { detectLanguage } from '@/shared/lib/language-utils'
import { apiClient } from '@/shared/lib/api-client'
import { fileUpdateBus, isContentChange } from '@/shared/lib/fileUpdateBus'
import { useMonacoTheme } from '@/shared/hooks/useMonacoTheme'
import { useAbsoluteFilePath } from '@/shared/hooks/useAbsoluteFilePath'
import { EditorContainer } from '@/shared/components/EditorContainer'
import { DiffViewModeToggle } from './DiffViewModeToggle'

interface DiffViewerProps {
  sessionId: string
  filePath: string
  diffFiles: DiffFile[]
  workspaceId: string
  worktreePath: string
  isActive?: boolean
  /** 存在时展示该历史提交的 diff（parent vs commit），而非工作区未提交 diff */
  commitHash?: string
}

export const DiffViewer = memo(function DiffViewer({
  sessionId,
  filePath,
  diffFiles,
  workspaceId,
  worktreePath,
  isActive,
  commitHash,
}: DiffViewerProps) {
  const [mode, setMode] = useState<'split' | 'unified'>('split')
  const [content, setContent] = useState<{ original: string; modified: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const monacoTheme = useMonacoTheme()

  const currentFile = diffFiles.find((f) => f.path === filePath)
  const absoluteFilePath = useAbsoluteFilePath(worktreePath, filePath, workspaceId)

  useEffect(() => {
    if (!filePath || !sessionId) return
    setLoading(true)
    setError(null)
    setContent(null)
    const controller = new AbortController()
    const url = commitHash
      ? `/sessions/${sessionId}/git-commit-diff`
      : `/sessions/${sessionId}/diff-content`
    const params = commitHash ? { hash: commitHash, file: filePath } : { file: filePath }
    apiClient
      .get<{ original: string; modified: string }>(url, {
        params,
        signal: controller.signal,
        toast: false,
      })
      .then((data) => setContent(data))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return
        setError(String(e))
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [filePath, sessionId, commitHash])

  useEffect(() => {
    // 历史提交 diff 是固定内容，不随工作区文件变化实时重拉
    if (commitHash) return
    return fileUpdateBus.on(sessionId, (event) => {
      if (event.filePath !== filePath) return
      if (!isContentChange(event)) return // 文件被删除（重命名/移动旧路径）时重拉必然 404，跳过
      apiClient
        .get<{ original: string; modified: string }>(`/sessions/${sessionId}/diff-content`, {
          params: { file: filePath },
          toast: '重新加载 diff 失败',
        })
        .then((data) => setContent(data))
        .catch((e: unknown) => console.error('[DiffViewer] reload content failed:', e))
    })
  }, [sessionId, filePath, commitHash])

  useEffect(() => {
    if (!isActive) return
    const editor = diffEditorRef.current
    if (!editor) return
    try {
      editor.layout()
    } catch {
      /* ignore */
    }
  }, [isActive])

  const handleEditorMount = useCallback((editor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor
  }, [])

  const diffStats = currentFile ? (
    <div className="ml-auto flex items-center gap-2 text-[11px]">
      <span className="font-mono text-green-500">+{currentFile.additions}</span>
      <span className="font-mono text-red-400">-{currentFile.deletions}</span>
    </div>
  ) : null

  const renderBody = () => {
    if (!content) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          选择文件查看差异
        </div>
      )
    }

    return (
      <MonacoDiffEditor
        height="100%"
        language={detectLanguage(filePath)}
        original={content.original}
        modified={content.modified}
        theme={monacoTheme}
        onMount={handleEditorMount}
        options={{
          readOnly: true,
          renderSideBySide: mode === 'split',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineNumbers: 'on',
          padding: { top: 8, bottom: 8 },
          diffWordWrap: 'off',
        }}
      />
    )
  }

  return (
    <EditorContainer filePath={absoluteFilePath} loading={loading} error={error} headerExtra={diffStats}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <DiffViewModeToggle mode={mode} onChange={setMode} />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">{renderBody()}</div>
      </div>
    </EditorContainer>
  )
})
