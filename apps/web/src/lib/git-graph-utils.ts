import type { GitCommit } from '@akari/shared-types'

export const LANE_COLORS = [
  '#4f9ef8', '#f97316', '#22c55e', '#a855f7',
  '#ec4899', '#eab308', '#06b6d4', '#f43f5e',
]

export const ROW_H = 28
export const LANE_W = 18
export const DOT_R = 4
export const PAD_LEFT = 12
export const PAD_TOP = ROW_H / 2

export interface LaneInfo {
  lane: number
  color: string
}

export interface GraphEdge {
  fromRow: number
  toRow: number
  fromLane: number
  toLane: number
  color: string
}

export interface GraphResult {
  laneInfo: Map<string, LaneInfo>
  edges: GraphEdge[]
  maxLane: number
}

export function buildGraph(commits: GitCommit[]): GraphResult {
  const laneInfo = new Map<string, LaneInfo>()
  const edges: GraphEdge[] = []
  const openLanes: (string | null)[] = []
  const rowOf = new Map<string, number>()

  for (let i = 0; i < commits.length; i++) rowOf.set(commits[i]!.hash, i)

  const freeSlot = (): number => {
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

  const maxLane = Math.max(...Array.from(laneInfo.values()).map(l => l.lane), 0)
  return { laneInfo, edges, maxLane }
}

export function graphColWidth(maxLane: number): number {
  return Math.max(PAD_LEFT + (maxLane + 1) * LANE_W + DOT_R + 8, 80)
}

export function cx(lane: number): number {
  return PAD_LEFT + lane * LANE_W + DOT_R
}

export function cy(row: number): number {
  return PAD_TOP + row * ROW_H
}

export function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
