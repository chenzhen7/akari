import type { GitCommit } from '@akari/shared-types'

export const LANE_COLORS = [
  '#4f9ef8', '#f97316', '#22c55e', '#a855f7',
  '#ec4899', '#eab308', '#06b6d4', '#f43f5e',
  '#14b8a6', '#8b5cf6',
]

export const ROW_H = 24
export const LANE_W = 14
export const DOT_R = 3
export const PAD_LEFT = 10
export const PAD_TOP = ROW_H / 2

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

export interface IdeaGraphResult {
  positions: Map<string, IdeaGraphNode>
  edges: OrthogonalEdge[]
  graphWidth: number
  /** 逐行图形宽度（VS Code 风格）：只有实际占用多 lane 的行才变宽。长度 = 视觉行数（提交行 + 展开的文件行） */
  rowWidths: number[]
  svgHeight: number
  maxLane: number
  /** 每个提交的 dot 所在视觉行索引（提交 i 若展开 N 个文件行，则其下方提交整体下移） */
  commitVisualRows: number[]
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

function buildBranchPath(fromY: number, toY: number, fromLane: number, toLane: number): string {
  const x1 = cx(fromLane)
  const y1 = fromY
  const x2 = cx(toLane)
  const y2 = toY

  if (fromLane === toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const c1y = y1 + ROW_H / 2
  const c2y = y2 - ROW_H / 2

  return `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`
}

export function computeIdeaGraphLayout(
  commits: GitCommit[],
  _head: string,
  baseBranch?: string,
  /** expandedRows[i] = 提交 i 下方预留的文件行数（0 = 折叠）。行内展开后后续提交整体下移。 */
  expandedRows?: number[],
): IdeaGraphResult {
  const colors = assignBranchColors(commits, baseBranch)
  const primary = computePrimaryBranches(commits, colors)
  const laneOf = assignLanes(commits)

  // 视觉行映射：提交 i 的 dot 在第 commitVisualRows[i] 行，占 1 提交行 + expandedRows[i] 个文件行
  const exp = expandedRows ?? commits.map(() => 0)
  const commitVisualRows: number[] = new Array(commits.length)
  let visual = 0
  for (let i = 0; i < commits.length; i++) {
    commitVisualRows[i] = visual
    visual += 1 + (exp[i] ?? 0)
  }
  const totalVisualRows = visual

  const positions = new Map<string, IdeaGraphNode>()
  let maxLane = 0

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]!
    const lane = laneOf.get(commit.hash) ?? 0
    const branch = primary.get(commit.hash) ?? null
    const color = branch ? (colors.get(branch) ?? LANE_COLORS[0]!) : LANE_COLORS[lane % LANE_COLORS.length]!
    positions.set(commit.hash, { lane, color, branch, row, x: cx(lane), y: cy(commitVisualRows[row]!) })
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
      // 父提交不在列表时 toRow === row+1（原语义：edge 延伸至 svg 底部）
      const fromY = cy(commitVisualRows[row]!)
      const toVisualRow = toRow < commits.length ? commitVisualRows[toRow]! : totalVisualRows
      const toY = cy(toVisualRow)
      const d = buildBranchPath(fromY, toY, fromLane, toLane)

      edges.push({ fromRow: row, toRow, fromLane, toLane, color, branch, d })
    }
  }

  const graphWidth = Math.max(PAD_LEFT + (maxLane + 1) * LANE_W + DOT_R + 8, 80)
  const svgHeight = totalVisualRows * ROW_H

  // VS Code 风格：逐行计算图形宽度。某一行只占一根线时，消息紧跟其右侧；
  // 仅当该行实际有多 lane 的线（commit 自身 lane 或贯穿该行的边）时才变宽。
  // 展开的文件行也占视觉行：初值取所属提交 lane，边贯穿区间扩张，文件行回填所属提交宽度。
  const rowMaxLane = new Array<number>(totalVisualRows).fill(0)
  for (let i = 0; i < commits.length; i++) {
    rowMaxLane[commitVisualRows[i]!] = laneOf.get(commits[i]!.hash) ?? 0
  }
  for (const edge of edges) {
    const lo = commitVisualRows[edge.fromRow]!
    const hi = edge.toRow < commits.length ? commitVisualRows[edge.toRow]! : totalVisualRows - 1
    const ext = Math.max(edge.fromLane, edge.toLane)
    for (let r = lo; r <= hi; r++) {
      if (ext > rowMaxLane[r]!) rowMaxLane[r] = ext
    }
  }
  for (let i = 0; i < commits.length; i++) {
    const base = rowMaxLane[commitVisualRows[i]!]!
    const extra = exp[i] ?? 0
    for (let f = 1; f <= extra; f++) {
      const idx = commitVisualRows[i]! + f
      if (base > rowMaxLane[idx]!) rowMaxLane[idx] = base
    }
  }
  const rowWidths = rowMaxLane.map(rowGraphWidth)

  return { positions, edges, graphWidth, rowWidths, svgHeight, maxLane, commitVisualRows }
}

/** 单行图形宽度：紧贴该行最右侧 lane 的圆点右缘 + 少量间距，无全局最小值约束 */
export function rowGraphWidth(maxLaneAtRow: number): number {
  return PAD_LEFT + maxLaneAtRow * LANE_W + DOT_R * 2 + 4
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
