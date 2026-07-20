import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSession, DiffFile } from '@akari/shared-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  GitCommit, Trash2, GitMerge, GitPullRequest, Loader2, FileIcon,
  RefreshCw,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { apiClient } from '@/lib/api-client'
import { useTabStore } from '@/stores/tab-store'

function statusColor(s: DiffFile['status']) {
  return s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : s === 'R' ? 'text-blue-400' : 'text-amber-400'
}

function splitFilePath(path: string): { fileName: string; dirPath: string } {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) {
    return { fileName: path, dirPath: '' }
  }
  return { fileName: normalized.slice(lastSlash + 1), dirPath: normalized.slice(0, lastSlash + 1) }
}

interface DiffFileListProps {
  session: AgentSession
  onSelectFile: (path: string) => void
}

export function DiffFileList({ session, onSelectFile }: DiffFileListProps) {
  const diffFiles = session.diffFiles ?? []
  const hasDiff = diffFiles.length > 0
  const initialRefreshSessionRef = useRef<string | null>(null)

  const sortedFiles = useMemo(
    () => [...diffFiles].sort((a, b) => a.path.localeCompare(b.path)),
    [diffFiles],
  )

  // Commit dialog
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)

  // Discard dialog
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  // Single-file discard dialog
  const [discardFileTarget, setDiscardFileTarget] = useState<DiffFile | null>(null)
  const [discardingFile, setDiscardingFile] = useState(false)

  // Merge dialog
  const [mergeOpen, setMergeOpen] = useState(false)
  const [merging, setMerging] = useState(false)

  // Update from base dialog
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updating, setUpdating] = useState(false)

  // Refresh diff
  const [refreshing, setRefreshing] = useState(false)

  async function handleCommit() {
    if (!commitMsg.trim()) return
    setCommitting(true)
    try {
      await apiClient.post(`/sessions/${session.id}/git/commit`, { message: commitMsg.trim() }, { toast: '提交失败' })
      toast.success('已提交')
      setCommitMsg('')
      setCommitOpen(false)
    } finally {
      setCommitting(false)
    }
  }

  async function handleDiscard() {
    setDiscarding(true)
    try {
      await apiClient.post(`/sessions/${session.id}/git/discard`, undefined, { toast: '丢弃失败' })
      toast.success('已丢弃所有变更')
      setDiscardOpen(false)
    } finally {
      setDiscarding(false)
    }
  }

  function handleOpenFile(file: DiffFile) {
    useTabStore.getState().createTab(session.id, 'file', file.path)
  }

  async function handleDiscardFile(file: DiffFile) {
    setDiscardingFile(true)
    try {
      await apiClient.post(`/sessions/${session.id}/git/discard-file`, { filePath: file.path }, { toast: '丢弃文件失败' })
      toast.success(`已丢弃 ${file.path}`)
      setDiscardFileTarget(null)
    } finally {
      setDiscardingFile(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await apiClient.post(`/sessions/${session.id}/diff-refresh`, undefined, { toast: '刷新失败' })
    } finally {
      setRefreshing(false)
    }
  }

  async function handleMerge() {
    setMerging(true)
    try {
      await apiClient.post(`/sessions/${session.id}/git/merge`, { sourceBranch: session.branchName }, { toast: '合并失败' })
      toast.success(`已合并 ${session.branchName} → ${session.baseBranch}`)
      setMergeOpen(false)
    } finally {
      setMerging(false)
    }
  }

  async function handleUpdateFromBase() {
    setUpdating(true)
    try {
      await apiClient.post(`/sessions/${session.id}/git/update-branch`, undefined, { toast: '更新失败' })
      toast.success('已从主会话当前分支更新到当前分支')
      setUpdateOpen(false)
    } finally {
      setUpdating(false)
    }
  }

  const totalAdditions = diffFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = diffFiles.reduce((s, f) => s + f.deletions, 0)

  const activeTab = session.tabs.find(t => t.id === session.activeTabId)
  const selectedPath = activeTab?.type === 'diff' ? (activeTab.filePath ?? null) : null

  useEffect(() => {
    if (session.diffFiles !== undefined) return
    if (initialRefreshSessionRef.current === session.id) return
    if (session.diffSummary.additions === 0 && session.diffSummary.deletions === 0) return
    if (session.status === 'initializing' || session.status === 'archived') return

    initialRefreshSessionRef.current = session.id
    apiClient.post(`/sessions/${session.id}/diff-refresh`, undefined, { toast: false })
      .catch(err => {
        console.error('[DiffFileList] initial diff refresh failed:', err)
        initialRefreshSessionRef.current = null
      })
  }, [session.diffFiles, session.diffSummary.additions, session.diffSummary.deletions, session.id, session.status])

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">变更文件</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
          {diffFiles.length}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 font-mono text-[10px]">
            {totalAdditions > 0 && (
              <span className="text-green-500">+{totalAdditions}</span>
            )}
            {totalDeletions > 0 && (
              <span className="text-red-400">-{totalDeletions}</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={0}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={refreshing}
                    onClick={() => void handleRefresh()}
                  >
                    {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">刷新变更列表</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={0}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!hasDiff}
                    onClick={() => setCommitOpen(true)}
                  >
                    <GitCommit className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Commit 所有变更</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setUpdateOpen(true)}
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">从主会话当前分支更新</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setMergeOpen(true)}
                >
                  <GitMerge className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">合并到主会话当前分支</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex" tabIndex={0}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-red-400 hover:text-red-400"
                    disabled={!hasDiff}
                    onClick={() => setDiscardOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">丢弃所有变更</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Flat file list */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {sortedFiles.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无变更
          </div>
        )}
        {sortedFiles.map(file => {
          const isSelected = selectedPath === file.path
          const hasAdd = file.additions > 0
          const hasDel = file.deletions > 0
          const { fileName, dirPath } = splitFilePath(file.path)
          return (
            <Tooltip key={file.path}>
              <TooltipTrigger asChild>
                <div
                  onClick={() => onSelectFile(file.path)}
                  className={cn(
                    'group flex w-full cursor-pointer items-center gap-1.5 py-1 pl-1.5 pr-2 transition-colors',
                    isSelected
                      ? 'border-l-2 border-primary bg-accent/40'
                      : 'border-l-2 border-transparent hover:bg-muted/50',
                  )}
                >
                  <span className={cn('w-3.5 shrink-0 text-center text-[10px] font-bold leading-none', statusColor(file.status))}>
                    {file.status}
                  </span>
                  <div className="min-w-0 flex-1 truncate">
                    <span className="text-[12px] leading-tight text-foreground">{fileName}</span>
                    {dirPath && (
                      <span className="ml-1 text-[12px] leading-tight text-muted-foreground">{dirPath}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={e => {
                              e.stopPropagation()
                              handleOpenFile(file)
                            }}
                          >
                            <FileIcon className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">在编辑器中打开</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="h-6 w-6 text-red-400 hover:text-red-400"
                            onClick={e => {
                              e.stopPropagation()
                              setDiscardFileTarget(file)
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">丢弃此文件变更</TooltipContent>
                      </Tooltip>
                    </div>
                    {(hasAdd || hasDel) && (
                      <div className="font-mono text-[10px] leading-none">
                        {hasAdd && <span className="text-green-500">+{file.additions}</span>}
                        {hasAdd && hasDel && <span className="text-muted-foreground/50"> </span>}
                        {hasDel && <span className="text-red-400">-{file.deletions}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{file.path}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      {/* Commit dialog */}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>提交所有变更</DialogTitle>
            <DialogDescription>
              将暂存全部文件（git add -A）并创建新提交。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="提交信息（必填）"
            className="min-h-[80px] resize-none"
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleCommit()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitOpen(false)} disabled={committing}>取消</Button>
            <Button onClick={() => void handleCommit()} disabled={!commitMsg.trim() || committing}>
              {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '提交'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard dialog */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>丢弃所有变更</DialogTitle>
            <DialogDescription>
              将执行 <span className="font-mono text-foreground">git checkout -- .</span> 和{' '}
              <span className="font-mono text-foreground">git clean -fd</span>，
              撤销所有未提交的修改并删除未跟踪文件。此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)} disabled={discarding}>取消</Button>
            <Button variant="destructive" onClick={() => void handleDiscard()} disabled={discarding}>
              {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认丢弃'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard single file dialog */}
      <Dialog open={!!discardFileTarget} onOpenChange={open => { if (!open) setDiscardFileTarget(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>丢弃文件变更</DialogTitle>
            <DialogDescription className="break-words">
              将丢弃 <span className="break-all font-mono text-foreground">{discardFileTarget?.path}</span> 的变更。
              此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardFileTarget(null)} disabled={discardingFile}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => { if (discardFileTarget) void handleDiscardFile(discardFileTarget) }}
              disabled={discardingFile}
            >
              {discardingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认丢弃'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>合并到主会话当前分支</DialogTitle>
            <DialogDescription className="break-words">
              将把{' '}
              <span className="break-all font-mono text-foreground">{session.branchName}</span>{' '}
              合并（--no-ff）到主会话当前分支。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)} disabled={merging}>取消</Button>
            <Button onClick={() => void handleMerge()} disabled={merging}>
              {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认合并'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update from base dialog */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>从主会话当前分支更新</DialogTitle>
            <DialogDescription className="break-words">
              将把主会话当前分支的最新代码合并（--no-ff）到当前分支{' '}
              <span className="break-all font-mono text-foreground">{session.branchName}</span>。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateOpen(false)} disabled={updating}>取消</Button>
            <Button onClick={() => void handleUpdateFromBase()} disabled={updating}>
              {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '确认更新'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
