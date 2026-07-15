import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { GitBranch, RefreshCw, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GitCommit, GitLogResponse } from '@akari/shared-types'
import { useSessionStore } from '@/stores/session-store'
import { useShallow } from 'zustand/react/shallow'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { computeIdeaGraphLayout } from '@/lib/git-graph-utils'
import { GitGraphSvg } from './GitGraphSvg'
import { GitGraphRow } from './GitGraphRow'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'

const FULL_LOAD_LIMIT = 100
const SEARCH_DEBOUNCE_MS = 200

interface NewBranchDialogState {
  open: boolean
  hash: string
  name: string
}

interface BranchSelectorProps {
  branches: { name: string; isCurrent?: boolean }[]
  value: string
  onChange: (value: string) => void
}

function BranchSelector({ branches, value, onChange }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedLabel = value === '__all__' ? '所有分支' : value

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return branches
    return branches.filter(b => b.name.toLowerCase().includes(q))
  }, [branches, search])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const handleSelect = (name: string) => {
    onChange(name)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-6 w-36 items-center justify-between truncate rounded-sm border border-border bg-background px-2 text-xs text-foreground hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover shadow-md">
          <div className="border-b border-border p-1">
            <input
              autoFocus
              type="text"
              placeholder="搜索分支..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 w-full rounded-sm bg-transparent px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={e => {
                if (e.key === 'Enter' && filteredBranches.length > 0) {
                  handleSelect(filteredBranches[0]!.name)
                }
                if (e.key === 'Escape') setOpen(false)
              }}
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => handleSelect('__all__')}
              className={cn(
                'flex w-full items-center px-2 py-1 text-xs',
                value === '__all__' ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted/50',
              )}
            >
              所有分支
            </button>
            {filteredBranches.map(b => (
              <button
                key={b.name}
                type="button"
                onClick={() => handleSelect(b.name)}
                className={cn(
                  'flex w-full items-center px-2 py-1 text-xs',
                  value === b.name ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted/50',
                )}
              >
                <span className="truncate">{b.name}</span>
                {b.isCurrent && <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">当前</span>}
              </button>
            ))}
            {filteredBranches.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">无匹配分支</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface GitGraphPanelProps {
  sessionId: string
}

export function GitGraphPanel({ sessionId }: GitGraphPanelProps) {
  const gitLogs = useSessionStore(s => s.gitLogs[sessionId] ?? null)
  const setGitLog = useSessionStore(s => s.setGitLog)
  const selectedHash = useSessionStore(s => s.selectedGitCommits[sessionId] ?? null)
  const setSelectedHash = useSessionStore(s => s.setSelectedGitCommit)
  const { branchName, baseBranch } = useSessionStore(
    useShallow(s => {
      const session = s.sessions.find(sess => sess.id === sessionId)
      return {
        branchName: session?.branchName,
        baseBranch: session?.baseBranch,
      }
    }),
  )

  const [loading, setLoading] = useState(false)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branchFilter, setBranchFilter] = useState<string>('__all__')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS)
  const [newBranch, setNewBranch] = useState<NewBranchDialogState>({ open: false, hash: '', name: '' })

  // 默认选中当前分支
  useEffect(() => {
    if (branchName && branchFilter === '__all__') {
      setBranchFilter(branchName)
    }
  }, [branchName])

  const logData: GitLogResponse | null = gitLogs

  const fetchLog = useCallback((branch?: string) => {
    setLoading(true)
    apiClient.get<GitLogResponse>(`/sessions/${sessionId}/git-log`, {
      params: { limit: FULL_LOAD_LIMIT, branch },
      toast: '加载 Git 日志失败',
    })
      .then((data) => {
        setCommits(data.commits)
        setGitLog(sessionId, data)
      })
      .catch(err => console.error('[GitGraphPanel] fetch failed:', err))
      .finally(() => setLoading(false))
  }, [sessionId, setGitLog])

  // 初始化 / 切换会话 / 切换分支筛选时全量加载
  useEffect(() => {
    setSearchInput('')
    const branch = branchFilter === '__all__' ? undefined : branchFilter
    fetchLog(branch)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, branchFilter, fetchLog])

  // WebSocket 推送全量日志时同步到本地（仅在未做分支筛选时）
  useEffect(() => {
    if (branchFilter === '__all__' && logData && logData.commits.length > 0) {
      setCommits(logData.commits)
    }
  }, [logData, branchFilter])

  const filteredCommits = useMemo(() => {
    if (!search.trim()) return commits
    const q = search.trim().toLowerCase()
    return commits.filter(c =>
      c.message.toLowerCase().includes(q) ||
      c.shortHash.startsWith(q) ||
      c.author.toLowerCase().includes(q),
    )
  }, [commits, search])

  const layout = useMemo(
    () => computeIdeaGraphLayout(filteredCommits, logData?.head ?? '', baseBranch),
    [filteredCommits, logData?.head, baseBranch],
  )

  const localBranchNames = useMemo(
    () => new Set(logData?.branches.map(b => b.name) ?? []),
    [logData],
  )

  const handleCheckout = (hash: string) => {
    apiClient.post(`/sessions/${sessionId}/git/checkout`, { branch: hash }, { toast: 'Checkout 失败' })
      .catch(err => console.error('[GitGraphPanel] checkout failed:', err))
  }

  const handleCreateBranch = (hash: string) => {
    setNewBranch({ open: true, hash, name: '' })
  }

  const submitNewBranch = () => {
    if (!newBranch.name.trim()) return
    apiClient.post(`/sessions/${sessionId}/git/checkout`, {
      branch: newBranch.name.trim(),
      createNew: true,
      from: newBranch.hash,
    }, { toast: '创建分支失败' })
      .then(() => {
        const branch = branchFilter === '__all__' ? undefined : branchFilter
        fetchLog(branch)
      })
      .catch(err => console.error('[GitGraphPanel] create branch failed:', err))
    setNewBranch(prev => ({ ...prev, open: false, name: '' }))
  }

  const selectedCommit = useMemo(() => {
    if (!selectedHash) return null
    return filteredCommits.find(c => c.hash === selectedHash) ?? null
  }, [selectedHash, filteredCommits])

  if (commits.length === 0 && !loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <GitBranch className="h-8 w-8 opacity-40" />
        <span className="text-sm">暂无 Git 历史</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchLog(branchFilter === '__all__' ? undefined : branchFilter)}
        >
          刷新
        </Button>
      </div>
    )
  }

  const graphWidth = layout.graphWidth
  const svgHeight = layout.svgHeight

  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <BranchSelector
          branches={logData?.branches.map(b => ({ name: b.name, isCurrent: b.isCurrent })) ?? []}
          value={branchFilter}
          onChange={setBranchFilter}
        />
        <Input
          placeholder="搜索提交..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          className="h-6 min-w-0 flex-1 text-xs"
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filteredCommits.length} commits
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs"
          onClick={() => fetchLog(branchFilter === '__all__' ? undefined : branchFilter)}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* Scrollable graph + rows */}
      <div className="relative flex-1 overflow-auto py-2">
        <div
          className="relative"
          style={{ height: svgHeight, minWidth: graphWidth + 160 }}
        >
          <GitGraphSvg
            commits={filteredCommits}
            layout={layout}
            head={logData?.head ?? ''}
          />

          {filteredCommits.map((commit, row) => (
            <GitGraphRow
              key={commit.hash}
              commit={commit}
              row={row}
              node={layout.positions.get(commit.hash)}
              isSelected={commit.hash === selectedHash}
              isHead={commit.hash === logData?.head}
              graphWidth={layout.rowWidths[row] ?? graphWidth}
              localBranchNames={localBranchNames}
              onSelect={() => setSelectedHash(sessionId, selectedHash === commit.hash ? null : commit.hash)}
              onCheckout={handleCheckout}
              onCreateBranch={handleCreateBranch}
            />
          ))}
        </div>

        {loading && commits.length === 0 && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">加载中...</span>
          </div>
        )}
      </div>

      {/* Commit detail panel */}
      <div
        className={cn(
          'shrink-0 overflow-hidden border-t border-border bg-panel transition-all duration-150',
          selectedCommit ? 'h-[118px]' : 'h-0',
        )}
      >
        {selectedCommit && (
          <div className="flex h-full flex-col gap-2 px-4 py-3 text-xs">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="font-mono text-muted-foreground">{selectedCommit.shortHash}</span>
              <span className="text-muted-foreground">
                {selectedCommit.author}
                {selectedCommit.email && ` <${selectedCommit.email}>`}
              </span>
              <span className="ml-auto text-muted-foreground">
                {new Date(selectedCommit.date).toLocaleString('zh-CN')}
              </span>
            </div>

            <div className="font-medium text-foreground text-sm leading-snug">{selectedCommit.message}</div>

            {selectedCommit.parents.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Parents:</span>
                <div className="flex gap-1.5">
                  {selectedCommit.parents.map(p => (
                    <button
                      key={p}
                      className="font-mono text-[11px] text-primary hover:underline"
                      onClick={() => setSelectedHash(sessionId, p)}
                    >
                      {p.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedCommit.refs.filter(r => r && r !== 'HEAD').length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Refs:</span>
                <div className="flex gap-1.5">
                  {selectedCommit.refs.filter(r => r && r !== 'HEAD').map(ref => (
                    <Badge key={ref} variant="outline" className="h-4 px-1 text-[10px]">
                      {ref.startsWith('tag:') ? ref.replace('tag: ', '') : ref}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New branch dialog */}
      <Dialog
        open={newBranch.open}
        onOpenChange={open => {
          if (!open) setNewBranch(prev => ({ ...prev, open: false, name: '' }))
        }}
      >
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="text-sm">从提交新建分支</DialogTitle>
            <DialogDescription className="text-[11px]">
              基于提交 {newBranch.hash.slice(0, 12)} 创建新分支
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="分支名称"
            value={newBranch.name}
            onChange={e => setNewBranch(prev => ({ ...prev, name: e.target.value }))}
            onKeyDown={e => {
              if (e.key === 'Enter') submitNewBranch()
              if (e.key === 'Escape') setNewBranch(prev => ({ ...prev, open: false, name: '' }))
            }}
            className="my-3 h-8 text-xs"
          />
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setNewBranch(prev => ({ ...prev, open: false, name: '' }))}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={submitNewBranch}
              disabled={!newBranch.name.trim()}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
