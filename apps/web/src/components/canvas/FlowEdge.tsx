import { type FC } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'

const FlowEdge: FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}) => {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  const color = selected ? '#a78bfa' : '#818cf8'
  const gradId = `shimmer-${id}`
  const arrowId = `arrow-${id}`

  return (
    <>
      <defs>
        {/* 箭头 */}
        <marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L8,3 z" fill={color} opacity={selected ? 0.9 : 0.55} />
        </marker>

        {/* 光扫渐变：窄亮带 + 两侧渐隐，沿 x 轴平移 */}
        <linearGradient id={gradId} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={color} stopOpacity="0" />
          <stop offset="30%"  stopColor={color} stopOpacity="0" />
          <stop offset="50%"  stopColor="white" stopOpacity="1" />
          <stop offset="70%"  stopColor={color} stopOpacity="0" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            from="-1 0"
            to="2 0"
            dur="3.5s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>

      {/* 底层实线（静态轨道） */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2 : 1.5}
        strokeOpacity={selected ? 0.65 : 0.3}
        markerEnd={`url(#${arrowId})`}
      />

      {/* 光扫层：用同路径 + 渐变 stroke */}
      <path
        d={edgePath}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={selected ? 5 : 3}
        strokeLinecap="round"
      />
    </>
  )
}

export default FlowEdge
