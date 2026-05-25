import { useEffect, useRef, useState, useCallback } from 'react'
import { GitBranch, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GitCommit, GitLogResponse } from '@akari/shared-types'
import { useSessionStore } from '@/stores/session-store'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

const LANE_W = 20
const ROW_H = 36
const DOT_R = 5
const PAD_LEFT = 16
const PAD_TOP = 20

const LANE_COLORS = [
  '#4f9ef8', '#f97316', '#22c55e', '#a855f7',
  '#ec4899', '#eab308', '#06b6d4', '#f43f5e',
]

interface LaneInfo {
  lane: number
  color: string
}

interface Edge {
  fromRow: number
  toRow: number
  fromLane: number
  toLane: number
  color: string
}

function buildGraph(commits: GitCommit[]): { laneInfo: Map<string, LaneInfo>; edges: Edge[] } {
  const laneInfo = new Map<string, LaneInfo>()
  const edges: Edge[] = []
  const openLanes: (string | null)[] = []
  const rowOf = new Map<string, number>()

  for (let i = 0; i < commits.length; i++) rowOf.set(commits[i]!.hash, i)

  const freeSlot = () => {
    const idx = openLanes.findIndex(h => h === null)
    if (idx >= 0) return idx
    openLanes.push(null)
    return openLanes.length - 1
  }

  for (let rowIdx = 0; rowIdx < commits.length; rowIdx++) {
    const commit = commits[rowIdx]!

    const existingLane = openLanes.findIndex(h => h === commit.hash)
    const lane = existingLane >= 0 ? existingLane : freeSlot()
    openLanes[lane] = null

    const color = LANE_COLORS[lane % LANE_COLORS.length]!
    laneInfo.set(commit.hash, { lane, color })

    for (let pIdx = 0; pIdx < commit.parents.length; pIdx++) {
      const parentHash = commit.parents[pIdx]!
      const alreadyOpen = openLanes.findIndex(h => h === parentHash)

      let targetLane: number
      if (alreadyOpen >= 0) {
        targetLane = alreadyOpen
      } else if (pIdx === 0) {
        targetLane = lane
        openLanes[lane] = parentHash
      } else {
        targetLane = freeSlot()
        openLanes[targetLane] = parentHash
      }

      const parentRow = rowOf.get(parentHash) ?? rowIdx + 1
      const edgeColor = pIdx === 0 ? color : LANE_COLORS[targetLane % LANE_COLORS.length]!
      edges.push({ fromRow: rowIdx, toRow: parentRow, fromLane: lane, toLane: targetLane, color: edgeColor })
    }
  }

  return { laneInfo, edges }
}

interface TooltipState {
  commit: GitCommit
  x: number
  y: number
}

interface GitGraphPanelProps {
  sessionId: string
}

export function GitGraphPanel({ sessionId }: GitGraphPanelProps) {
  const gitLogs = useSessionStore(s => s.gitLogs)
  const setGitLog = useSessionStore(s => s.setGitLog)
  const [loading, setLoading] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  if (!logData || logData.commits.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        {loading ? (
          <RefreshCw className="h-5 w-5 animate-spin" />
        ) : (
          <>
            <GitBranch className="h-8 w-8 opacity-40" />
            <span className="text-sm">暂无 Git 历史</span>
            <Button variant="outline" size="sm" onClick={fetchLog}>
              刷新
            </Button>
          </>
        )}
      </div>
    )
  }

  const { commits } = logData
  const { laneInfo, edges } = buildGraph(commits)
  const maxLane = Math.max(...Array.from(laneInfo.values()).map(l => l.lane), 0)
  const svgWidth = PAD_LEFT + (maxLane + 1) * LANE_W + 600
  const svgHeight = PAD_TOP + commits.length * ROW_H + PAD_TOP

  const cx = (lane: number) => PAD_LEFT + lane * LANE_W + DOT_R
  const cy = (row: number) => PAD_TOP + row * ROW_H + DOT_R

  return (
    <div className="relative h-full overflow-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-xs font-medium text-muted-foreground">
          {commits.length} commits
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={fetchLog} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <svg
        ref={svgRef}
        width={svgWidth}
        height={svgHeight}
        className="font-mono text-xs select-none"
        onMouseLeave={() => setTooltip(null)}
      >
        {edges.map((edge, i) => {
          const x1 = cx(edge.fromLane)
          const y1 = cy(edge.fromRow)
          const x2 = cx(edge.toLane)
          const y2 = cy(edge.toRow)
          const isStraight = edge.fromLane === edge.toLane
          const d = isStraight
            ? `M ${x1} ${y1} L ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
          return (
            <path
              key={i}
              d={d}
              stroke={edge.color}
              strokeWidth={1.5}
              fill="none"
              opacity={0.7}
            />
          )
        })}

        {commits.map((commit, rowIdx) => {
          const info = laneInfo.get(commit.hash)!
          const x = cx(info.lane)
          const y = cy(rowIdx)
          const isHead = commit.hash === logData.head
          const labelX = PAD_LEFT + (maxLane + 1) * LANE_W + 8

          return (
            <g
              key={commit.hash}
              className="cursor-pointer"
              onMouseEnter={e => {
                const rect = svgRef.current?.getBoundingClientRect()
                if (!rect) return
                setTooltip({ commit, x: e.clientX - rect.left, y: e.clientY - rect.top })
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={DOT_R}
                fill={isHead ? '#ffffff' : info.color}
                stroke={info.color}
                strokeWidth={isHead ? 2 : 1}
              />

              <text x={labelX} y={y + 4} fill="hsl(var(--muted-foreground))" fontSize={11}>
                <tspan fill={info.color} fontWeight="600">{commit.shortHash}</tspan>
                {'  '}
                <tspan fill="hsl(var(--foreground))">{truncate(commit.message, 72)}</tspan>
              </text>

              {commit.refs.filter(r => r && r !== 'HEAD').map((ref, ri) => {
                const refX = labelX + commit.shortHash.length * 7 + 12 + ri * 80
                return (
                  <g key={ri}>
                    <rect
                      x={refX - 2}
                      y={y - 8}
                      width={Math.min(ref.length * 6.5 + 8, 120)}
                      height={14}
                      rx={3}
                      fill={ri === 0 ? info.color : 'hsl(var(--muted))'}
                      opacity={0.85}
                    />
                    <text
                      x={refX + 2}
                      y={y + 3}
                      fill={ri === 0 ? '#000' : 'hsl(var(--foreground))'}
                      fontSize={9}
                      fontWeight="600"
                    >
                      {truncate(ref, 14)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-border bg-popover px-3 py-2 shadow-md text-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y }}
        >
          <div className="font-mono text-muted-foreground">{tooltip.commit.hash.slice(0, 12)}</div>
          <div className="mt-0.5 font-medium text-foreground">{tooltip.commit.message}</div>
          <div className="mt-1 text-muted-foreground">
            {tooltip.commit.author} · {new Date(tooltip.commit.date).toLocaleString('zh-CN')}
          </div>
          {tooltip.commit.parents.length > 1 && (
            <div className="mt-0.5 text-amber-500 text-[10px]">⎇ merge commit</div>
          )}
        </div>
      )}
    </div>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
