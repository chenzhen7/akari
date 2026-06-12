import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { GitBranch, RefreshCw, GitMerge, Tag, Globe, CircleDot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import type { GitCommit, GitLogResponse } from '@akari/shared-types'
import { useSessionStore } from '@/stores/session-store'
import {
  computeGitgraphLayout,
  COMPACT_DOT_R,
  type GitgraphNode,
} from '@/lib/gitgraph-layout'
import {
  truncate,
  ROW_H,
} from '@/lib/git-graph-utils'
import { GitContextMenu } from './GitContextMenu'
import { cn } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
const PAGE_SIZE = 50

interface ContextMenuState {
  commit: GitCommit
  x: number
  y: number
  hasBranch: boolean
}

interface NewBranchState {
  hash: string
  name: string
}

interface GitGraphPanelProps {
  sessionId: string
}

export function GitGraphPanel({ sessionId }: GitGraphPanelProps) {
  const gitLogs = useSessionStore(s => s.gitLogs)
  const setGitLog = useSessionStore(s => s.setGitLog)
  const session = useSessionStore(s => s.sessions.find(sess => sess.id === sessionId))
  const [loading, setLoading] = useState(false)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState<string>('__all__')
  const [search, setSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [newBranch, setNewBranch] = useState<NewBranchState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 分页状态（组件本地管理，不依赖 store 中的完整数据）
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const logData: GitLogResponse | null = gitLogs[sessionId] ?? null

  const fetchLog = useCallback((branch?: string, currentOffset = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(currentOffset),
    })
    if (branch) params.set('branch', branch)
    fetch(`${API_BASE}/sessions/${sessionId}/git-log?${params}`)
      .then(r => r.json())
      .then((data: GitLogResponse) => {
        if (currentOffset === 0) {
          setCommits(data.commits)
        } else {
          setCommits(prev => [...prev, ...data.commits])
        }
        setOffset(currentOffset + data.commits.length)
        setHasMore(data.commits.length === PAGE_SIZE)
        setGitLog(sessionId, data)
      })
      .catch(err => console.error('[GitGraphPanel] fetch failed:', err))
      .finally(() => setLoading(false))
  }, [sessionId, setGitLog])

  // 初始化加载 / 切换会话时重置
  useEffect(() => {
    setCommits([])
    setOffset(0)
    setHasMore(true)
    setSelectedHash(null)
    setSearch('')
    fetchLog(branchFilter === '__all__' ? undefined : branchFilter, 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 分支切换时重置并重新加载
  useEffect(() => {
    setCommits([])
    setOffset(0)
    setHasMore(true)
    const branch = branchFilter === '__all__' ? undefined : branchFilter
    fetchLog(branch, 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter])

  // 滚动到底部加载更多
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (nearBottom && hasMore && !loading) {
      const branch = branchFilter === '__all__' ? undefined : branchFilter
      fetchLog(branch, offset)
    }
  }, [hasMore, loading, branchFilter, offset, fetchLog])

  // 搜索只在已加载数据中过滤
  const filteredCommits = useMemo(() => {
    if (!search.trim()) return commits
    const q = search.trim().toLowerCase()
    return commits.filter(c =>
      c.message.toLowerCase().includes(q) ||
      c.shortHash.startsWith(q) ||
      c.author.toLowerCase().includes(q),
    )
  }, [commits, search])

  const { positions, edges, graphWidth, svgHeight } = useMemo(
    () => commits.length > 0 && logData
      ? computeGitgraphLayout(filteredCommits, logData.head, session?.baseBranch)
      : { positions: new Map<string, GitgraphNode>(), edges: [], graphWidth: 80, svgHeight: 0 },
    [filteredCommits, commits.length, logData, session?.baseBranch],
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
    }).catch(err => console.error('[GitGraphPanel] checkout failed:', err))
  }

  const handleCreateBranch = (hash: string) => {
    setNewBranch({ hash, name: '' })
  }

  const submitNewBranch = () => {
    if (!newBranch?.name.trim()) return
    fetch(`${API_BASE}/sessions/${sessionId}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: newBranch.name.trim(), createNew: true, from: newBranch.hash }),
    })
      .then(() => {
        setCommits([])
        setOffset(0)
        setHasMore(true)
        fetchLog(branchFilter === '__all__' ? undefined : branchFilter, 0)
      })
      .catch(err => console.error('[GitGraphPanel] create branch failed:', err))
    setNewBranch(null)
  }

  if (commits.length === 0 && !loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <GitBranch className="h-8 w-8 opacity-40" />
        <span className="text-sm">暂无 Git 历史</span>
        <Button variant="outline" size="sm" onClick={() => fetchLog(branchFilter === '__all__' ? undefined : branchFilter, 0)}>刷新</Button>
      </div>
    )
  }

  const selectedCommit = selectedHash
    ? filteredCommits.find(c => c.hash === selectedHash) ?? null
    : null

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
          {hasMore && !search.trim() && ' +'}
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => fetchLog(branchFilter === '__all__' ? undefined : branchFilter, 0)} disabled={loading}>
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* Graph + rows (scrollable) */}
      <div ref={scrollRef} className="relative flex-1 overflow-auto" onScroll={handleScroll}>
        {/* Canvas area */}
        <div className="relative" style={{ height: svgHeight, minWidth: graphWidth + 160 }}>

          {/* SVG graph layer */}
          <svg
            width={graphWidth}
            height={svgHeight}
            className="pointer-events-none absolute left-0 top-0 select-none"
          >
            {edges.map((edge, i) => (
              <path
                key={i}
                d={edge.d}
                stroke={edge.color}
                strokeWidth={1.5}
                fill="none"
                opacity={0.75}
              />
            ))}

            {filteredCommits.map(commit => {
              const node = positions.get(commit.hash)
              if (!node) return null
              const isHead = commit.hash === logData?.head
              return (
                <circle
                  key={commit.hash}
                  cx={node.x}
                  cy={node.y}
                  r={COMPACT_DOT_R}
                  fill={isHead ? 'hsl(var(--background))' : node.color}
                  stroke={node.color}
                  strokeWidth={isHead ? 2 : 1.5}
                />
              )
            })}
          </svg>

          {/* DOM rows */}
          {filteredCommits.map((commit, rowIdx) => {
            const node = positions.get(commit.hash)
            const isSelected = commit.hash === selectedHash
            const branchRefs = commit.refs.filter(r => r && r !== 'HEAD')

            return (
              <div
                key={commit.hash}
                className={cn(
                  'absolute flex w-full cursor-pointer items-center text-xs transition-colors',
                  isSelected
                    ? 'bg-accent/30 border-l-2 border-primary'
                    : 'border-l-2 border-transparent hover:bg-muted/50',
                )}
                style={{ top: rowIdx * ROW_H, height: ROW_H, left: 0, right: 0 }}
                onClick={() => setSelectedHash(isSelected ? null : commit.hash)}
                onContextMenu={e => {
                  e.preventDefault()
                  setContextMenu({
                    commit,
                    x: e.clientX,
                    y: e.clientY,
                    hasBranch: branchRefs.length > 0,
                  })
                }}
              >
                {/* Message column: leave left graphWidth for SVG dots, then show refs + message */}
                <div
                  className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-2"
                  style={{ paddingLeft: graphWidth }}
                >
                  {branchRefs.slice(0, 3).map((ref, ri) => {
                    const isRemote = ref.includes('/') && !localBranchNames.has(ref)
                    const isTag = ref.startsWith('tag:')
                    const isHead = commit.hash === logData?.head && ri === 0
                    const label = isTag ? ref.replace('tag: ', '') : ref
                    const Icon = isTag ? Tag : isRemote ? Globe : isHead ? CircleDot : GitBranch
                    return (
                      <Tooltip key={ri}>
                        <TooltipTrigger asChild>
                          <Badge
                            variant={isHead ? 'default' : isRemote ? 'secondary' : 'outline'}
                            className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5"
                            style={!isHead && !isRemote && !isTag && node ? { borderColor: node.color, color: node.color } : undefined}
                          >
                            <Icon className="h-3 w-3 shrink-0" />
                            {truncate(label, 16)}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[11px]">{label}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                  <span className={cn('min-w-0 truncate', commit.parents.length > 1 ? 'text-muted-foreground' : 'text-foreground')}>
                    {commit.message}
                  </span>
                  {commit.parents.length > 1 && (
                    <Badge variant="outline" className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5 border-amber-500/50 text-amber-500">
                      <GitMerge className="h-3 w-3" />
                      merge
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Loading more indicator */}
        {loading && commits.length > 0 && (
          <div className="flex items-center justify-center py-3 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">加载更多...</span>
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
            {/* Hash + Author + Date */}
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

            {/* Message */}
            <div className="font-medium text-foreground text-sm leading-snug">{selectedCommit.message}</div>

            {/* Parents */}
            {selectedCommit.parents.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Parents:</span>
                <div className="flex gap-1.5">
                  {selectedCommit.parents.map(p => (
                    <button
                      key={p}
                      className="font-mono text-[11px] text-primary hover:underline"
                      onClick={() => setSelectedHash(p)}
                    >
                      {p.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Refs */}
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

      {/* Context menu */}
      {contextMenu && (
        <GitContextMenu
          commit={contextMenu.commit}
          x={contextMenu.x}
          y={contextMenu.y}
          hasBranch={contextMenu.hasBranch}
          onClose={() => setContextMenu(null)}
          onCheckout={handleCheckout}
          onCreateBranch={handleCreateBranch}
        />
      )}

      {/* New branch inline dialog */}
      {newBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-72 rounded-lg border border-border bg-popover p-4 shadow-xl">
            <div className="mb-3 text-sm font-medium">从提交新建分支</div>
            <div className="mb-1 font-mono text-[11px] text-muted-foreground">{newBranch.hash.slice(0, 12)}</div>
            <Input
              autoFocus
              placeholder="分支名称"
              value={newBranch.name}
              onChange={e => setNewBranch(b => b ? { ...b, name: e.target.value } : null)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewBranch(); if (e.key === 'Escape') setNewBranch(null) }}
              className="mb-3 h-7 text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setNewBranch(null)}>取消</Button>
              <Button size="sm" className="h-7 text-xs" onClick={submitNewBranch} disabled={!newBranch.name.trim()}>创建</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
