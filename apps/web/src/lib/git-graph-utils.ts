import type { GitCommit } from '@akari/shared-types'

export const LANE_COLORS = [
  '#4f9ef8', '#f97316', '#22c55e', '#a855f7',
  '#ec4899', '#eab308', '#06b6d4', '#f43f5e',
  '#14b8a6', '#8b5cf6',
]

export const ROW_H = 28
export const LANE_W = 18
export const DOT_R = 4
export const PAD_LEFT = 12
export const PAD_TOP = ROW_H / 2

const CORNER_R = 3

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

export interface IdeaGraphNode {
  lane: number
  color: string
  branch: string | null
  row: number
  x: number
  y: number
}

export interface OrthogonalEdge {
  fromRow: number
  toRow: number
  fromLane: number
  toLane: number
  color: string
  branch: string | null
  d: string
}

export interface BranchPath {
  branch: string
  color: string
  rows: number[]
  laneSegments: Array<{ startRow: number; endRow: number; lane: number }>
}

export interface IdeaGraphResult {
  positions: Map<string, IdeaGraphNode>
  edges: OrthogonalEdge[]
  branchPaths: Map<string, BranchPath>
  graphWidth: number
  svgHeight: number
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

function collectBranchNames(commits: GitCommit[]): Set<string> {
  const names = new Set<string>()
  for (const c of commits) {
    for (const ref of c.refs) {
      if (ref !== 'HEAD' && !ref.startsWith('tag:')) {
        names.add(ref)
      }
    }
  }
  return names
}

export function assignBranchColors(commits: GitCommit[], baseBranch?: string): Map<string, string> {
  const names = Array.from(collectBranchNames(commits)).sort((a, b) => {
    if (baseBranch) {
      if (a === baseBranch) return -1
      if (b === baseBranch) return 1
    }
    return a.localeCompare(b)
  })
  return new Map(names.map((name, i) => [name, LANE_COLORS[i % LANE_COLORS.length]!]))
}

function computePrimaryBranches(commits: GitCommit[], colors: Map<string, string>): Map<string, string | null> {
  const primary = new Map<string, string | null>()

  for (let i = commits.length - 1; i >= 0; i--) {
    const commit = commits[i]!
    const branchRefs = commit.refs.filter(r => r !== 'HEAD' && !r.startsWith('tag:'))

    if (branchRefs.length > 0) {
      const named = branchRefs.find(r => colors.has(r)) ?? branchRefs[0]!
      primary.set(commit.hash, named)
    } else if (commit.parents.length > 0) {
      primary.set(commit.hash, primary.get(commit.parents[0]!) ?? null)
    } else {
      primary.set(commit.hash, null)
    }
  }

  return primary
}

function assignLanes(commits: GitCommit[]): Map<string, number> {
  const laneOf = new Map<string, number>()
  const openLanes: (string | null)[] = []
  const rowOf = new Map<string, number>()

  for (let i = 0; i < commits.length; i++) rowOf.set(commits[i]!.hash, i)

  const freeSlot = (): number => {
    const idx = openLanes.findIndex(h => h === null)
    if (idx >= 0) return idx
    openLanes.push(null)
    return openLanes.length - 1
  }

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]!
    const existingLane = openLanes.findIndex(h => h === commit.hash)
    const lane = existingLane >= 0 ? existingLane : freeSlot()
    openLanes[lane] = null
    laneOf.set(commit.hash, lane)

    for (let pIdx = 0; pIdx < commit.parents.length; pIdx++) {
      const parentHash = commit.parents[pIdx]!
      const alreadyOpen = openLanes.findIndex(h => h === parentHash)
      if (alreadyOpen >= 0) continue

      if (pIdx === 0) {
        openLanes[lane] = parentHash
      } else {
        const newLane = freeSlot()
        openLanes[newLane] = parentHash
      }
    }
  }

  return laneOf
}

function buildOrthogonalPath(fromRow: number, toRow: number, fromLane: number, toLane: number): string {
  const x1 = cx(fromLane)
  const y1 = cy(fromRow)
  const x2 = cx(toLane)
  const y2 = cy(toRow)

  if (fromLane === toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const yTurn = y1 + ROW_H / 2
  const right = x2 > x1
  const xr = right ? CORNER_R : -CORNER_R
  const sweep = right ? 1 : 0

  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${yTurn - CORNER_R}`,
    `A ${CORNER_R} ${CORNER_R} 0 0 ${sweep} ${x1 + xr} ${yTurn}`,
    `L ${x2 - xr} ${yTurn}`,
    `A ${CORNER_R} ${CORNER_R} 0 0 ${sweep} ${x2} ${yTurn + CORNER_R}`,
    `L ${x2} ${y2}`,
  ].join(' ')
}

function buildBranchPaths(
  commits: GitCommit[],
  positions: Map<string, IdeaGraphNode>,
  edges: OrthogonalEdge[],
  colors: Map<string, string>,
): Map<string, BranchPath> {
  const map = new Map<string, BranchPath>()
  const rowsByBranch = new Map<string, Set<number>>()

  for (const edge of edges) {
    if (!edge.branch) continue
    const set = rowsByBranch.get(edge.branch) ?? new Set<number>()
    set.add(edge.fromRow)
    set.add(edge.toRow)
    rowsByBranch.set(edge.branch, set)
  }

  for (const [branch, color] of colors.entries()) {
    const set = rowsByBranch.get(branch) ?? new Set<number>()
    const rows = Array.from(set).sort((a, b) => a - b)
    const laneSegments: Array<{ startRow: number; endRow: number; lane: number }> = []

    for (const row of rows) {
      const lane = positions.get(commits[row]!.hash)?.lane ?? 0
      const last = laneSegments[laneSegments.length - 1]
      if (last && last.lane === lane && last.endRow === row - 1) {
        last.endRow = row
      } else {
        laneSegments.push({ startRow: row, endRow: row, lane })
      }
    }

    map.set(branch, { branch, color, rows, laneSegments })
  }

  return map
}

export function computeIdeaGraphLayout(
  commits: GitCommit[],
  _head: string,
  baseBranch?: string,
): IdeaGraphResult {
  const colors = assignBranchColors(commits, baseBranch)
  const primary = computePrimaryBranches(commits, colors)
  const laneOf = assignLanes(commits)

  const positions = new Map<string, IdeaGraphNode>()
  let maxLane = 0

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]!
    const lane = laneOf.get(commit.hash) ?? 0
    const branch = primary.get(commit.hash) ?? null
    const color = branch ? (colors.get(branch) ?? LANE_COLORS[0]!) : LANE_COLORS[lane % LANE_COLORS.length]!
    positions.set(commit.hash, { lane, color, branch, row, x: cx(lane), y: cy(row) })
    maxLane = Math.max(maxLane, lane)
  }

  const rowOf = new Map<string, number>()
  for (let i = 0; i < commits.length; i++) rowOf.set(commits[i]!.hash, i)

  const edges: OrthogonalEdge[] = []

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]!
    const fromLane = laneOf.get(commit.hash) ?? 0
    const commitBranch = primary.get(commit.hash) ?? null

    for (let pIdx = 0; pIdx < commit.parents.length; pIdx++) {
      const parentHash = commit.parents[pIdx]!
      const toLane = laneOf.get(parentHash) ?? 0
      const toRow = rowOf.get(parentHash) ?? row + 1

      let branch = commitBranch
      if (pIdx > 0) {
        branch = primary.get(parentHash) ?? null
      }
      const color = branch ? (colors.get(branch) ?? LANE_COLORS[toLane % LANE_COLORS.length]!) : LANE_COLORS[toLane % LANE_COLORS.length]!
      const d = buildOrthogonalPath(row, toRow, fromLane, toLane)

      edges.push({ fromRow: row, toRow, fromLane, toLane, color, branch, d })
    }
  }

  const branchPaths = buildBranchPaths(commits, positions, edges, colors)
  const graphWidth = Math.max(PAD_LEFT + (maxLane + 1) * LANE_W + DOT_R + 8, 80)
  const svgHeight = commits.length * ROW_H

  return { positions, edges, branchPaths, graphWidth, svgHeight, maxLane }
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
