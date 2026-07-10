import { useState, useMemo, useEffect, useRef } from 'react'
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
  ChevronRight, ChevronDown, Folder, FolderOpen, RefreshCw,
} from 'lucide-react'
import { toast, toastError } from '@/lib/toast'
import { API_BASE } from '@/lib/api'
import { useSessionStore } from '@/stores/session-store'

function statusColor(s: DiffFile['status']) {
  return s === 'A' ? 'text-green-500' : s === 'D' ? 'text-red-500' : s === 'R' ? 'text-blue-400' : 'text-amber-400'
}

interface TreeNode {
  id: string
  name: string
  path: string
  isDirectory: boolean
  fileCount: number
  additions: number
  deletions: number
  children: TreeNode[]
  file?: DiffFile
}

function buildTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = {
    id: '__root__',
    name: '',
    path: '',
    isDirectory: true,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    children: [],
  }
  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/')
    const name = parts.pop() ?? file.path
    let current = root
    current.fileCount++
    current.additions += file.additions
    current.deletions += file.deletions
    for (const part of parts) {
      const path = current.path ? `${current.path}/${part}` : part
      let child = current.children.find(c => c.name === part && c.isDirectory)
      if (!child) {
        child = {
          id: path,
          name: part,
          path,
          isDirectory: true,
          fileCount: 0,
          additions: 0,
          deletions: 0,
          children: [],
        }
        current.children.push(child)
      }
      current = child
      current.fileCount++
      current.additions += file.additions
      current.deletions += file.deletions
    }
    const filePath = file.path
    current.children.push({
      id: filePath,
      name,
      path: filePath,
      isDirectory: false,
      fileCount: 1,
      additions: file.additions,
      deletions: file.deletions,
      children: [],
      file,
    })
  }
  sortTree(root)
  return compressSingleChildDirs(root)
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children) {
    if (child.isDirectory) sortTree(child)
  }
}

function compressSingleChildDirs(node: TreeNode): TreeNode {
  if (!node.isDirectory) return node
  const compressedChildren = node.children.map(compressSingleChildDirs)
  node.children = compressedChildren
  // 合并只有一个子目录的目录，避免树太深
  if (node.path !== '' && node.children.length === 1 && node.children[0]!.isDirectory) {
    const child = node.children[0]!
    return {
      ...child,
      id: `${node.id}/${child.name}`,
      name: `${node.name}/${child.name}`,
      path: child.path,
      fileCount: node.fileCount,
      additions: node.additions,
      deletions: node.deletions,
    }
  }
  return node
}

function FileTreeNode({
  node,
  depth,
  expanded,
  toggleExpanded,
  selectedPath,
  onSelectFile,
  onOpenFile,
  onDiscardFile,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  toggleExpanded: (id: string) => void
  selectedPath: string | null
  onSelectFile: (path: string) => void
  onOpenFile: (file: DiffFile) => void
  onDiscardFile: (file: DiffFile) => void
}) {
  if (!node.isDirectory) {
    const f = node.file!
    const isSelected = selectedPath === f.path
    const hasAdd = f.additions > 0
    const hasDel = f.deletions > 0
    return (
      <div
        key={f.path}
        onClick={() => onSelectFile(f.path)}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-1.5 py-1 pl-1.5 pr-2 transition-colors',
          isSelected
            ? 'border-l-2 border-primary bg-accent/40'
            : 'border-l-2 border-transparent hover:bg-muted/50',
        )}
        style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
      >
        <span className={cn('w-3.5 shrink-0 text-center text-[10px] font-bold leading-none', statusColor(f.status))}>
          {f.status}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] leading-tight text-foreground">{node.name}</div>
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
                    onOpenFile(f)
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
                    onDiscardFile(f)
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
              {hasAdd && <span className="text-green-500">+{f.additions}</span>}
              {hasAdd && hasDel && <span className="text-muted-foreground/50"> </span>}
              {hasDel && <span className="text-red-400">-{f.deletions}</span>}
            </div>
          )}
        </div>
      </div>
    )
  }

  const isExpanded = expanded.has(node.id)
  const isRoot = node.path === ''
  return (
    <div key={node.id}>
      {!isRoot && (
        <div
          onClick={() => toggleExpanded(node.id)}
          className="group flex w-full cursor-pointer items-center gap-1.5 py-1 pl-1.5 pr-2 transition-colors hover:bg-muted/50"
          style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          )}
          <div className="min-w-0 flex-1 truncate text-[12px] leading-tight text-foreground">{node.name}</div>
          <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">{node.fileCount}</span>
        </div>
      )}
      {isExpanded &&
        node.children.map(child => (
          <FileTreeNode
            key={child.id}
            node={child}
            depth={isRoot ? depth : depth + 1}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onOpenFile={onOpenFile}
            onDiscardFile={onDiscardFile}
          />
        ))}
    </div>
  )
}

interface DiffFileListProps {
  session: AgentSession
  onSelectFile: (path: string) => void
}

export function DiffFileList({ session, onSelectFile }: DiffFileListProps) {
  const diffFiles = session.diffFiles ?? []
  const hasDiff = diffFiles.length > 0

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
      const res = await fetch(`${API_BASE}/sessions/${session.id}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg.trim() }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success('已提交')
      setCommitMsg('')
      setCommitOpen(false)
    } catch (e) {
      toastError(`提交失败: ${String(e)}`)
    } finally {
      setCommitting(false)
    }
  }

  async function handleDiscard() {
    setDiscarding(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.id}/git/discard`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success('已丢弃所有变更')
      setDiscardOpen(false)
    } catch (e) {
      toastError(`丢弃失败: ${String(e)}`)
    } finally {
      setDiscarding(false)
    }
  }

  function handleOpenFile(file: DiffFile) {
    useSessionStore.getState().createTab(session.id, 'file', file.path)
  }

  async function handleDiscardFile(file: DiffFile) {
    setDiscardingFile(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.id}/git/discard-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: file.path }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success(`已丢弃 ${file.path}`)
      setDiscardFileTarget(null)
    } catch (e) {
      toastError(`丢弃文件失败: ${String(e)}`)
    } finally {
      setDiscardingFile(false)
    }
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.id}/diff-refresh`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
    } catch (e) {
      toastError(`刷新失败: ${String(e)}`)
    } finally {
      setRefreshing(false)
    }
  }

  async function handleMerge() {
    setMerging(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.id}/git/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBranch: session.branchName }),
      })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success(`已合并 ${session.branchName} → ${session.baseBranch}`)
      setMergeOpen(false)
    } catch (e) {
      toastError(`合并失败: ${String(e)}`)
    } finally {
      setMerging(false)
    }
  }

  async function handleUpdateFromBase() {
    setUpdating(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.id}/git/update-branch`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? res.statusText)
      }
      toast.success('已从主会话当前分支更新到当前分支')
      setUpdateOpen(false)
    } catch (e) {
      toastError(`更新失败: ${String(e)}`)
    } finally {
      setUpdating(false)
    }
  }

  const totalAdditions = diffFiles.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = diffFiles.reduce((s, f) => s + f.deletions, 0)

  const tree = useMemo(() => buildTree(diffFiles), [diffFiles])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const prevPathsRef = useRef<string>('')

  useEffect(() => {
    const pathsKey = diffFiles.map(f => f.path).join('\n')
    if (pathsKey === prevPathsRef.current) return
    prevPathsRef.current = pathsKey

    setExpanded(prev => {
      const allDirIds = new Set<string>()
      function collect(node: TreeNode) {
        if (node.isDirectory) {
          allDirIds.add(node.id)
          node.children.forEach(collect)
        }
      }
      collect(tree)
      // 首次加载全部展开；后续保留用户折叠状态
      if (prev.size === 0) return allDirIds
      const next = new Set<string>()
      for (const id of prev) {
        if (allDirIds.has(id)) next.add(id)
      }
      return next
    })
  }, [diffFiles, tree])

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeTab = session.tabs.find(t => t.id === session.activeTabId)
  const selectedPath = activeTab?.type === 'diff' ? (activeTab.filePath ?? null) : null

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

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {diffFiles.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无变更
          </div>
        )}
        {diffFiles.length > 0 && (
          <FileTreeNode
            node={tree}
            depth={0}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            onOpenFile={handleOpenFile}
            onDiscardFile={setDiscardFileTarget}
          />
        )}
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
