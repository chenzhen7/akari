import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentSession } from '@akari/shared-types'
import {
  GitCommit, Trash2, GitMerge, GitPullRequest, Loader2,
  RefreshCw,
} from 'lucide-react'
import { toast } from '@/shared/lib/toast'
import { apiClient } from '@/shared/lib/api-client'
import { useDiffReviewStore } from '../stores/diff-review-store'
import { DiffFileTreeNode, buildFileTree, type FileTreeNode } from './DiffFileTreeNode'
import { Button } from '@/shared/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Textarea } from '@/shared/components/ui/textarea'
import { ScrollArea } from '@/shared/components/ui/scroll-area'

interface DiffFileListProps {
  session: AgentSession
  onSelectFile: (path: string) => void
}

function collectAllPaths(node: FileTreeNode): string[] {
  const paths = [node.path]
  if (node.children) {
    for (const child of node.children) {
      paths.push(...collectAllPaths(child))
    }
  }
  return paths
}

export function DiffFileList({ session, onSelectFile }: DiffFileListProps) {
  const diffFiles = session.diffFiles ?? []
  const hasDiff = diffFiles.length > 0
  const initialRefreshSessionRef = useRef<string | null>(null)

  const diffFilesKey = useMemo(() => diffFiles.map((f) => f.path).sort().join('\0'), [diffFiles])
  const tree = useMemo(() => buildFileTree(diffFiles), [diffFilesKey])
  const allPaths = useMemo(() => collectAllPaths(tree), [tree])

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const initializedPathsRef = useRef(false)
  useEffect(() => {
    if (initializedPathsRef.current) return
    if (allPaths.length === 0) return
    initializedPathsRef.current = true
    setExpandedPaths(new Set(allPaths.filter(Boolean)))
  }, [allPaths])

  const resetSession = useDiffReviewStore((s) => s.resetSession)

  // Commit dialog
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitScope, setCommitScope] = useState<'all' | 'viewed'>('all')

  const sessionReviewState = useDiffReviewStore((s) => s.states[session.id])
  const viewedFiles = useMemo(
    () => diffFiles.filter((f) => sessionReviewState?.[f.path]?.viewed).map((f) => f.path),
    [diffFiles, sessionReviewState],
  )
  const viewedFileCount = viewedFiles.length

  // Discard dialog
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)

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
    if (commitScope === 'viewed' && viewedFileCount === 0) return
    setCommitting(true)
    try {
      const payload: { message: string; scope?: 'all' | 'viewed'; filePaths?: string[] } = {
        message: commitMsg.trim(),
      }
      if (commitScope === 'viewed') {
        payload.scope = 'viewed'
        payload.filePaths = viewedFiles
      }
      await apiClient.post(`/sessions/${session.id}/git/commit`, payload, { toast: '提交失败' })
      toast.success(commitScope === 'viewed' ? `已提交 ${viewedFileCount} 个已查看文件` : '已提交')
      resetSession(session.id)
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
      resetSession(session.id)
      setDiscardOpen(false)
    } finally {
      setDiscarding(false)
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

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const totalAdditions = diffFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = diffFiles.reduce((s, f) => s + f.deletions, 0)

  const activeTab = session.tabs.find((t) => t.id === session.activeTabId)
  const scrollTarget = useDiffReviewStore((s) => s.scrollTargets[session.id])
  const selectedPath = activeTab?.filePath ?? scrollTarget?.filePath ?? null

  useEffect(() => {
    if (session.diffFiles !== undefined) return
    if (initialRefreshSessionRef.current === session.id) return
    if (session.diffSummary.additions === 0 && session.diffSummary.deletions === 0) return
    if (session.status === 'initializing' || session.status === 'archived') return

    initialRefreshSessionRef.current = session.id
    apiClient.post(`/sessions/${session.id}/diff-refresh`, undefined, { toast: false })
      .catch((err) => {
        console.error('[DiffFileList] initial diff refresh failed:', err)
        initialRefreshSessionRef.current = null
      })
  }, [session.diffFiles, session.diffSummary.additions, session.diffSummary.deletions, session.id, session.status])

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 bg-muted/30 px-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">变更文件</span>
        <span className="rounded-full bg-background px-1.5 py-px text-[11px] font-medium text-muted-foreground shadow-sm">
          {diffFiles.length}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 font-mono text-[11px]">
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

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="px-1 py-1">
          {diffFiles.length === 0 && (
            <div className="flex h-full items-center justify-center py-6 text-xs text-muted-foreground">
              暂无变更
            </div>
          )}
          {tree.children.map((child) => (
            <DiffFileTreeNode
              key={child.path}
              sessionId={session.id}
              node={child}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Commit dialog */}
      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>提交变更</DialogTitle>
            <DialogDescription>
              {commitScope === 'all'
                ? `将暂存全部 ${diffFiles.length} 个变更文件并创建新提交。`
                : `只提交已查看的 ${viewedFileCount} 个文件，其余文件继续保留在工作区。`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Button
              size="xs"
              variant={commitScope === 'all' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setCommitScope('all')}
            >
              全部提交
            </Button>
            <Button
              size="xs"
              variant={commitScope === 'viewed' ? 'default' : 'outline'}
              className="flex-1"
              disabled={viewedFileCount === 0}
              onClick={() => setCommitScope('viewed')}
            >
              只提交已查看 ({viewedFileCount})
            </Button>
          </div>

          <Textarea
            placeholder="提交信息（必填）"
            className="min-h-[80px] resize-none"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleCommit()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommitOpen(false)} disabled={committing}>取消</Button>
            <Button
              onClick={() => void handleCommit()}
              disabled={!commitMsg.trim() || committing || (commitScope === 'viewed' && viewedFileCount === 0)}
            >
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
