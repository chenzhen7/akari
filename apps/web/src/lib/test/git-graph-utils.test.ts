import { describe, it, expect } from 'vitest'
import {
  assignBranchColors,
  computeIdeaGraphLayout,
  rowGraphWidth,
  graphColWidth,
  cx,
  cy,
  relativeTime,
  truncate,
  LANE_COLORS,
  ROW_H,
  LANE_W,
  PAD_LEFT,
  DOT_R,
  PAD_TOP,
} from '../git-graph-utils'
import type { GitCommit } from '@akari/shared-types'

function makeCommit(overrides: Partial<GitCommit> & { hash: string }): GitCommit {
  return {
    shortHash: overrides.hash.slice(0, 7),
    message: 'commit',
    author: 'dev',
    email: 'dev@example.com',
    date: new Date().toISOString(),
    parents: [],
    refs: [],
    ...overrides,
  }
}

describe('assignBranchColors', () => {
  it('assigns colors to branch names', () => {
    const commits = [
      makeCommit({ hash: 'a', refs: ['main'] }),
      makeCommit({ hash: 'b', refs: ['feature'] }),
    ]
    const colors = assignBranchColors(commits)
    // Branches are sorted alphabetically: 'feature' < 'main'
    expect(colors.get('feature')).toBe(LANE_COLORS[0])
    expect(colors.get('main')).toBe(LANE_COLORS[1])
  })

  it('puts base branch first', () => {
    const commits = [
      makeCommit({ hash: 'a', refs: ['feature'] }),
      makeCommit({ hash: 'b', refs: ['main'] }),
    ]
    const colors = assignBranchColors(commits, 'main')
    expect(colors.get('main')).toBe(LANE_COLORS[0])
    expect(colors.get('feature')).toBe(LANE_COLORS[1])
  })

  it('ignores HEAD and tags', () => {
    const commits = [makeCommit({ hash: 'a', refs: ['HEAD', 'tag:v1', 'main'] })]
    const colors = assignBranchColors(commits)
    expect(colors.has('HEAD')).toBe(false)
    expect(colors.has('tag:v1')).toBe(false)
    expect(colors.has('main')).toBe(true)
  })
})

describe('computeIdeaGraphLayout', () => {
  it('lays out a linear history on a single lane', () => {
    const commits = [
      makeCommit({ hash: 'c1', parents: ['c2'] }),
      makeCommit({ hash: 'c2', parents: ['c3'] }),
      makeCommit({ hash: 'c3', parents: [] }),
    ]
    const result = computeIdeaGraphLayout(commits, 'c1')
    expect(result.maxLane).toBe(0)
    expect(result.positions.get('c1')!.lane).toBe(0)
    expect(result.positions.get('c2')!.lane).toBe(0)
    expect(result.positions.get('c3')!.lane).toBe(0)
  })

  it('creates a second lane for merge commits', () => {
    const commits = [
      makeCommit({ hash: 'm', parents: ['a', 'b'] }),
      makeCommit({ hash: 'a', parents: ['base'] }),
      makeCommit({ hash: 'b', parents: ['base'] }),
      makeCommit({ hash: 'base', parents: [] }),
    ]
    const result = computeIdeaGraphLayout(commits, 'm')
    expect(result.maxLane).toBeGreaterThanOrEqual(1)
    expect(result.edges.length).toBe(4)
  })

  it('computes SVG height based on row count', () => {
    const commits = [makeCommit({ hash: 'a' }), makeCommit({ hash: 'b' })]
    const result = computeIdeaGraphLayout(commits, 'a')
    expect(result.svgHeight).toBe(2 * ROW_H)
  })
})

describe('geometry helpers', () => {
  it('cx places dot center at correct x', () => {
    expect(cx(0)).toBe(PAD_LEFT + DOT_R)
    expect(cx(1)).toBe(PAD_LEFT + LANE_W + DOT_R)
  })

  it('cy places row center at correct y', () => {
    expect(cy(0)).toBe(PAD_TOP)
    expect(cy(1)).toBe(PAD_TOP + ROW_H)
  })

  it('rowGraphWidth grows with lane count', () => {
    expect(rowGraphWidth(0)).toBeLessThan(rowGraphWidth(1))
  })

  it('graphColWidth has minimum', () => {
    expect(graphColWidth(0)).toBeGreaterThanOrEqual(80)
  })
})

describe('relativeTime', () => {
  it('returns 刚刚 for recent timestamps', () => {
    const iso = new Date(Date.now() - 30_000).toISOString()
    expect(relativeTime(iso)).toBe('刚刚')
  })

  it('returns minutes for recent past', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(relativeTime(iso)).toBe('5m ago')
  })

  it('returns date string for old timestamps', () => {
    const iso = new Date('2020-01-15T00:00:00Z').toISOString()
    expect(relativeTime(iso)).toMatch(/\d{2}[/-]\d{2}/)
  })
})

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 6)).toBe('hello…')
  })
})
