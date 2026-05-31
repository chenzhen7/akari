import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { GitBranch, RefreshCw, Copy, Check, GitMerge, Tag, Globe, User, Clock, CircleDot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import type { GitCommit, GitLogResponse } from '@akari/shared-types'
import { useSessionStore } from '@/stores/session-store'
import {
  buildGraph,
  graphColWidth,
  cx as laneCx,
  cy as laneCy,
  relativeTime,
  truncate,
  ROW_H,
  DOT_R,
} from '@/lib/git-graph-utils'
import { GitContextMenu } from './GitContextMenu'
import { cn } from '@/lib/utils'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

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
  const [loading, setLoading] = useState(false)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState<string>('__all__')
  const [search, setSearch] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [newBranch, setNewBranch] = useState<NewBranchState | null>(null)
  const [copiedHash, setCopiedHash] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const logData: GitLogResponse | null = gitLogs[sessionId] ?? null

  const fetchLog = useCallback(() => {
    setLoading(true)
    fetch(`${API_BASE}/sessions/${sessionId}/git-log?limit=150`)
      .then(r => r.json())
      .then((data: GitLogResponse) => setGitLog(sessionId, data))
      .catch(err => console.error('[GitGraphPanel] fetch failed:', err))
      .finally(() => setLoading(false))
  }, [sessionId, setGitLog])

  useEffect(() => {
    if (!logData) fetchLog()
  }, [sessionId, logData, fetchLog])

  const filteredCommits = useMemo(() => {
    if (!logData) return []
    let commits = logData.commits
    if (branchFilter !== '__all__') {
      const branchCommit = logData.branches.find(b => b.name === branchFilter)?.commit
      if (branchCommit) {
        const idx = commits.findIndex(c => c.hash === branchCommit)
        commits = idx >= 0 ? commits.slice(0, idx + 1) : commits
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      commits = commits.filter(c =>
        c.message.toLowerCase().includes(q) ||
        c.shortHash.startsWith(q) ||
        c.author.toLowerCase().includes(q),
      )
    }
    return commits
  }, [logData, branchFilter, search])

  const { laneInfo, edges, maxLane } = useMemo(
    () => buildGraph(filteredCommits),
    [filteredCommits],
  )

  const localBranchNames = useMemo(
    () => new Set(logData?.branches.map(b => b.name) ?? []),
    [logData],
  )

  const gColW = graphColWidth(maxLane)
  const svgH = ROW_H * filteredCommits.length

  const handleCopyHash = (hash: string) => {
    void navigator.clipboard.writeText(hash)
    setCopiedHash(true)
    setTimeout(() => setCopiedHash(false), 1500)
  }

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
      .then(() => fetchLog())
      .catch(err => console.error('[GitGraphPanel] create branch failed:', err))
    setNewBranch(null)
  }

  if (!logData || logData.commits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        {loading ? (
          <RefreshCw className="h-5 w-5 animate-spin" />
        ) : (
          <>
            <GitBranch className="h-8 w-8 opacity-40" />
            <span className="text-sm">暂无 Git 历史</span>
            <Button variant="outline" size="sm" onClick={fetchLog}>刷新</Button>
          </>
        )}
      </div>
    )
  }

  const selectedCommit = selectedHash
    ? filteredCommits.find(c => c.hash === selectedHash) ?? null
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <select
          value={branchFilter}
          onChange={e => setBranchFilter(e.target.value)}
          className="h-6 rounded-sm border border-border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="__all__">所有分支</option>
          {logData.branches.map(b => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        <Input
          placeholder="搜索提交..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-6 w-44 text-xs"
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filteredCommits.length} commits
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={fetchLog} disabled={loading}>
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* Table header */}
      <div
        className="flex shrink-0 items-center border-b border-border bg-muted/30 text-[11px] font-medium text-muted-foreground select-none"
        style={{ height: 26 }}
      >
        <div className="px-2" style={{ width: gColW + 160 }}>提交信息</div>
        <div className="px-2" style={{ width: 120 }}>作者</div>
        <div className="px-2" style={{ width: 80 }}>时间</div>
        <div className="px-2 font-mono" style={{ width: 72 }}>Hash</div>
      </div>

      {/* Graph + rows (scrollable) */}
      <div ref={scrollRef} className="relative flex-1 overflow-auto">
        {/* Canvas area */}
        <div className="relative" style={{ height: svgH, minWidth: gColW + 160 + 120 + 80 + 72 }}>

          {/* SVG graph layer */}
          <svg
            width={gColW}
            height={svgH}
            className="pointer-events-none absolute left-0 top-0 select-none"
          >
            {edges.map((edge, i) => {
              const x1 = laneCx(edge.fromLane)
              const y1 = laneCy(edge.fromRow)
              const x2 = laneCx(edge.toLane)
              const y2 = laneCy(edge.toRow)
              const straight = edge.fromLane === edge.toLane
              const d = straight
                ? `M ${x1} ${y1} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
              return (
                <path key={i} d={d} stroke={edge.color} strokeWidth={1.5} fill="none" opacity={0.75} />
              )
            })}

            {filteredCommits.map((commit, rowIdx) => {
              const info = laneInfo.get(commit.hash)
              if (!info) return null
              const x = laneCx(info.lane)
              const y = laneCy(rowIdx)
              const isHead = commit.hash === logData.head
              return (
                <circle
                  key={commit.hash}
                  cx={x}
                  cy={y}
                  r={DOT_R}
                  fill={isHead ? 'hsl(var(--background))' : info.color}
                  stroke={info.color}
                  strokeWidth={isHead ? 2 : 1.5}
                />
              )
            })}
          </svg>

          {/* DOM rows */}
          {filteredCommits.map((commit, rowIdx) => {
            const info = laneInfo.get(commit.hash)
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
                {/* Message column: leave left gColW for SVG dots, then show refs + message */}
                <div
                  className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-2"
                  style={{ paddingLeft: gColW }}
                >
                  {branchRefs.slice(0, 3).map((ref, ri) => {
                    const isRemote = ref.includes('/') && !localBranchNames.has(ref)
                    const isTag = ref.startsWith('tag:')
                    const isHead = commit.hash === logData.head && ri === 0
                    const label = isTag ? ref.replace('tag: ', '') : ref
                    const Icon = isTag ? Tag : isRemote ? Globe : isHead ? CircleDot : GitBranch
                    return (
                      <Tooltip key={ri}>
                        <TooltipTrigger asChild>
                          <Badge
                            variant={isHead ? 'default' : isRemote ? 'secondary' : 'outline'}
                            className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5"
                            style={!isHead && !isRemote && !isTag && info ? { borderColor: info.color, color: info.color } : undefined}
                          >
                            <Icon className="h-3 w-3 shrink-0" />
                            {truncate(label, 16)}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-[11px]">{label}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                  <span className="min-w-0 truncate text-foreground">
                    {commit.message}
                  </span>
                  {commit.parents.length > 1 && (
                    <Badge variant="outline" className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0 text-[11px] h-5 border-amber-500/50 text-amber-500">
                      <GitMerge className="h-3 w-3" />
                      merge
                    </Badge>
                  )}
                </div>

                {/* Author */}
                <div
                  className="shrink-0 truncate px-2 text-muted-foreground"
                  style={{ width: 120 }}
                >
                  {commit.author}
                </div>

                {/* Date */}
                <div
                  className="shrink-0 px-2 tabular-nums text-muted-foreground"
                  style={{ width: 80 }}
                >
                  {relativeTime(commit.date)}
                </div>

                {/* Hash */}
                <div
                  className="shrink-0 px-2 font-mono text-muted-foreground"
                  style={{ width: 72 }}
                >
                  {commit.shortHash}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Commit detail panel */}
      <div
        className={cn(
          'shrink-0 overflow-hidden border-t border-border bg-card transition-all duration-150',
          selectedCommit ? 'h-[118px]' : 'h-0',
        )}
      >
        {selectedCommit && (
          <div className="flex flex-col gap-1 px-4 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-muted-foreground text-[11px]">{selectedCommit.hash}</span>
              <button
                onClick={() => handleCopyHash(selectedCommit.hash)}
                className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                {copiedHash ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
            <div className="font-medium text-foreground leading-snug">{selectedCommit.message}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3 shrink-0 text-foreground/40" />
                {selectedCommit.author} &lt;{selectedCommit.email}&gt;
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 shrink-0 text-foreground/40" />
                {new Date(selectedCommit.date).toLocaleString('zh-CN')}
              </span>
              {selectedCommit.parents.length > 1 && (
                <span className="flex items-center gap-1 text-amber-500">
                  <GitMerge className="h-3 w-3 shrink-0" />
                  {selectedCommit.parents.map(p => p.slice(0, 7)).join(', ')}
                </span>
              )}
            </div>
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
          onCopyHash={handleCopyHash}
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
