import {
  GitgraphCore,
  TemplateName,
  templateExtend,
  toSvgPath,
} from '@gitgraph/core'
import type { GitCommit } from '@akari/shared-types'
import { ROW_H, LANE_W, PAD_LEFT, PAD_TOP, DOT_R } from './git-graph-utils'

const template = templateExtend(TemplateName.BlackArrow, {
  colors: [
    '#4f9ef8', '#f97316', '#22c55e', '#a855f7',
    '#ec4899', '#eab308', '#06b6d4', '#f43f5e',
  ],
  commit: {
    spacing: ROW_H,
    dot: { size: DOT_R * 2, strokeWidth: 0 },
    message: { display: false, displayAuthor: false, displayHash: false, font: '' },
  },
  branch: {
    color: '',
    spacing: LANE_W,
    label: { display: false, color: '', strokeColor: '', bgColor: '', font: '', borderRadius: 0 },
  },
  tag: { color: '', font: '', borderRadius: 0, pointerWidth: 0 },
  arrow: { color: null, size: null, offset: 0 },
})

function toGit2Json(commits: GitCommit[], head: string): unknown[] {
  return commits.map(c => ({
    hash: c.hash,
    parents: c.parents,
    author: {
      name: c.author,
      email: c.email,
      timestamp: Math.floor(new Date(c.date).getTime() / 1000),
    },
    subject: c.message,
    refs: [
      ...(c.hash === head ? ['HEAD'] : []),
      ...c.refs,
    ],
  }))
}

export interface GitgraphNode {
  x: number
  y: number
  color: string
}

export interface GitgraphEdge {
  d: string
  color: string
}

export interface GitgraphLayout {
  positions: Map<string, GitgraphNode>
  edges: GitgraphEdge[]
  graphWidth: number
  svgHeight: number
}

export function computeGitgraphLayout(
  commits: GitCommit[],
  head: string,
): GitgraphLayout {
  const core = new GitgraphCore<SVGElement>({
    template,
    initCommitOffsetX: PAD_LEFT,
    initCommitOffsetY: PAD_TOP,
  })

  const data = toGit2Json(commits, head)
  core.getUserApi().import(data)

  const rendered = core.getRenderedData()

  const positions = new Map<string, GitgraphNode>()
  let maxX = 0
  let maxY = 0

  rendered.commits.forEach(commit => {
    const color = commit.style?.color ?? commit.style?.dot?.color ?? '#4f9ef8'
    positions.set(commit.hash, {
      x: commit.x,
      y: commit.y,
      color,
    })
    maxX = Math.max(maxX, commit.x)
    maxY = Math.max(maxY, commit.y)
  })

  const edges: GitgraphEdge[] = []
  rendered.branchesPaths.forEach((coordinates, branch) => {
    const d = toSvgPath(coordinates, true, true)
    const color = branch.computedColor || branch.style?.color || '#4f9ef8'
    edges.push({ d, color })
  })

  return {
    positions,
    edges,
    graphWidth: Math.max(maxX + PAD_LEFT + DOT_R * 2, 80),
    svgHeight: maxY + PAD_TOP + DOT_R * 2,
  }
}
