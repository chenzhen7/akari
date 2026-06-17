import type { GitCommit } from '@akari/shared-types'
import type { IdeaGraphResult } from '@/lib/git-graph-utils'
import { DOT_R, PAD_LEFT, LANE_W } from '@/lib/git-graph-utils'

interface GitGraphSvgProps {
  commits: GitCommit[]
  layout: IdeaGraphResult
  head: string
}

export function GitGraphSvg({ commits, layout, head }: GitGraphSvgProps) {
  const { positions, edges, graphWidth, svgHeight, maxLane } = layout

  return (
    <svg
      width={graphWidth}
      height={svgHeight}
      className="pointer-events-none absolute left-0 top-0 select-none"
    >
      {/* Lane background bands */}
      {Array.from({ length: maxLane + 1 }, (_, lane) => (
        <rect
          key={`lane-bg-${lane}`}
          x={PAD_LEFT + lane * LANE_W}
          y={0}
          width={LANE_W}
          height={svgHeight}
          fill={lane % 2 === 0 ? 'color-mix(in oklch, var(--foreground) 2%, transparent)' : 'transparent'}
        />
      ))}

      {/* Orthogonal branch lines */}
      <g className="branch-lines">
        {edges.map((edge, i) => (
          <path
            key={`edge-${i}`}
            d={edge.d}
            stroke={edge.color}
            strokeWidth={1.5}
            fill="none"
            opacity={0.75}
          />
        ))}
      </g>

      {/* Commit dots */}
      <g className="commit-dots">
        {commits.map((commit) => {
          const node = positions.get(commit.hash)
          if (!node) return null
          const isHead = commit.hash === head

          return (
            <circle
              key={commit.hash}
              cx={node.x}
              cy={node.y}
              r={DOT_R}
              fill={isHead ? 'var(--background)' : node.color}
              stroke={node.color}
              strokeWidth={isHead ? 2.5 : 1.5}
            />
          )
        })}
      </g>
    </svg>
  )
}
