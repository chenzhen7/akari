import { useEffect, useMemo, useState, useCallback } from 'react'
import { GitBranch, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
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
import { computeIdeaGraphLayout } from '@/lib/git-graph-utils'
import { GitGraphSvg } from './GitGraphSvg'
import { GitGraphRow } from './GitGraphRow'
import { cn } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
const FULL_LOAD_LIMIT = 100000

interface NewBranchDialogState {
  open: boolean
  hash: string
  name: string
}

interface GitGraphPanelProps {
  sessionId: string
}

export function GitGraphPanel({ sessionId }: GitGraphPanelProps) {
  const gitLogs = useSessionStore(s => s.gitLogs)
  const setGitLog = useSessionStore(s => s.setGitLog)
  const selectedHash = useSessionStore(s => s.selectedGitCommits[sessionId] ?? null)
  const setSelectedHash = useSessionStore(s => s.setSelectedGitCommit)
  const session = useSessionStore(s => s.sessions.find(sess => sess.id === sessionId))

  const [loading, setLoading] = useState(false)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branchFilter, setBranchFilter] = useState<string>('__all__')
  const [search, setSearch] = useState('')
  const [newBranch, setNewBranch] = useState<NewBranchDialogState>({ open: false, hash: '', name: '' })

  const logData: GitLogResponse | null = gitLogs[sessionId] ?? null

  const fetchLog = useCallback((branch?: string) => {
    setLoading(true)
    const params = new URLSearchParams({ limit: String(FULL_LOAD_LIMIT) })
    if (branch) params.set('branch', branch)

    fetch(`${API_BASE}/sessions/${sessionId}/git-log?${params}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json() as Promise<GitLogResponse>
      })
      .then((data) => {
        setCommits(data.commits)
        setGitLog(sessionId, data)
      })
      .catch(err => {
        console.error('[GitGraphPanel] fetch failed:', err)
        toast.error(`加载 Git 日志失败: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoading(false))
  }, [sessionId, setGitLog])

  // 初始化 / 切换会话 / 切换分支筛选时全量加载
  useEffect(() => {
    setSearch('')
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
    () => computeIdeaGraphLayout(filteredCommits, logData?.head ?? '', session?.baseBranch),
    [filteredCommits, logData?.head, session?.baseBranch],
  )

  const localBranchNames = useMemo(
    () => new Set(logData?.branches.map(b => b.name) ?? []),
    [logData],
  )

  const handleCheckout = (hash: string) => {
    fetch(`${API_BASE}/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: hash }),
    })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
      })
      .catch(err => {
        console.error('[GitGraphPanel] checkout failed:', err)
        toast.error(`Checkout 失败: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  const handleCreateBranch = (hash: string) => {
    setNewBranch({ open: true, hash, name: '' })
  }

  const submitNewBranch = () => {
    if (!newBranch.name.trim()) return
    fetch(`${API_BASE}/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: newBranch.name.trim(), createNew: true, from: newBranch.hash }),
    })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        const branch = branchFilter === '__all__' ? undefined : branchFilter
        fetchLog(branch)
      })
      .catch(err => {
        console.error('[GitGraphPanel] create branch failed:', err)
        toast.error(`创建分支失败: ${err instanceof Error ? err.message : String(err)}`)
      })
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
        <select
          value={branchFilter}
          onChange={e => setBranchFilter(e.target.value)}
          className="h-6 w-28 shrink-0 truncate rounded-sm border border-border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="__all__">所有分支</option>
          {logData?.branches.map(b => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        <Input
          placeholder="搜索提交..."
          value={search}
          onChange={e => setSearch(e.target.value)}
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

      {/* Column headers */}
      <div
        className="grid shrink-0 border-b border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground"
        style={{
          gridTemplateColumns: `${graphWidth}px 1fr`,
        }}
      >
        <div />
        <div className="px-2">Message</div>
      </div>

      {/* Scrollable graph + rows */}
      <div className="relative flex-1 overflow-auto">
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
              graphWidth={graphWidth}
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
