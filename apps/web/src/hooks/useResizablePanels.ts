import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseResizablePanelsOptions {
  /** 左侧面板初始宽度（百分比，0-100） */
  initialLeftWidth?: number
  /** 左侧面板最小宽度（百分比） */
  minLeftWidth?: number
  /** 左侧面板最大宽度（百分比） */
  maxLeftWidth?: number
  /** 右侧面板初始宽度（百分比，0-100） */
  initialRightWidth?: number
  /** 右侧面板最小宽度（百分比） */
  minRightWidth?: number
  /** 右侧面板最大宽度（百分比） */
  maxRightWidth?: number
}

export interface UseResizablePanelsReturn {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  expandLeft: () => void
  collapseLeft: () => void
  expandRight: () => void
  collapseRight: () => void
  /** 按住并拖拽左侧分隔条 */
  onLeftHandleMouseDown: (e: React.MouseEvent) => void
  /** 按住并拖拽右侧分隔条 */
  onRightHandleMouseDown: (e: React.MouseEvent) => void
  /** 拖拽过程中是否在调整左侧（用于显示样式） */
  isDraggingLeft: boolean
  /** 拖拽过程中是否在调整右侧（用于显示样式） */
  isDraggingRight: boolean
  /** 挂载到容器以直接操作面板 DOM */
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function useResizablePanels(
  options: UseResizablePanelsOptions = {},
): UseResizablePanelsReturn {
  const {
    initialLeftWidth = 15,
    minLeftWidth = 12,
    maxLeftWidth = 30,
    initialRightWidth = 25,
    minRightWidth = 15,
    maxRightWidth = 40,
  } = options

  const [leftWidth, setLeftWidth] = useState(initialLeftWidth)
  const [rightWidth, setRightWidth] = useState(initialRightWidth)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(true)
  const [isDraggingLeft, setIsDraggingLeft] = useState(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  const dragStateRef = useRef<{
    startX: number
    startWidth: number
    dragTarget: 'left' | 'right'
    containerWidth: number
    panelEl: HTMLElement
  } | null>(null)

  const onMouseMove = useCallback((e: MouseEvent) => {
    const state = dragStateRef.current
    if (!state) return

    if (state.dragTarget === 'left') {
      const delta = e.clientX - state.startX
      const deltaPct = (delta / state.containerWidth) * 100
      const newWidth = Math.min(
        maxLeftWidth,
        Math.max(minLeftWidth, state.startWidth + deltaPct),
      )
      state.panelEl.style.width = `${newWidth}%`
    } else {
      const delta = state.startX - e.clientX
      const deltaPct = (delta / state.containerWidth) * 100
      const newWidth = Math.min(
        maxRightWidth,
        Math.max(minRightWidth, state.startWidth + deltaPct),
      )
      state.panelEl.style.width = `${newWidth}%`
    }
  }, [maxLeftWidth, minLeftWidth, maxRightWidth, minRightWidth])

  const onMouseUp = useCallback(() => {
    const state = dragStateRef.current
    if (!state) {
      setIsDraggingLeft(false)
      setIsDraggingRight(false)
      return
    }

    const width = parseFloat(state.panelEl.style.width)
    if (state.dragTarget === 'left') {
      setLeftWidth(width)
    } else {
      setRightWidth(width)
    }

    dragStateRef.current = null
    setIsDraggingLeft(false)
    setIsDraggingRight(false)
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  const onLeftHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingLeft(true)
    const container = containerRef.current
    if (!container) return
    const panelEl = container.querySelector<HTMLElement>('[data-resizable-panel="left"]')
    if (!panelEl) return
    dragStateRef.current = {
      startX: e.clientX,
      startWidth: leftWidth,
      dragTarget: 'left',
      containerWidth: container.offsetWidth,
      panelEl,
    }
  }, [leftWidth])

  const onRightHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingRight(true)
    const container = containerRef.current
    if (!container) return
    const panelEl = container.querySelector<HTMLElement>('[data-resizable-panel="right"]')
    if (!panelEl) return
    dragStateRef.current = {
      startX: e.clientX,
      startWidth: rightWidth,
      dragTarget: 'right',
      containerWidth: container.offsetWidth,
      panelEl,
    }
  }, [rightWidth])

  const expandLeft = useCallback(() => {
    setLeftCollapsed(false)
  }, [])

  const collapseLeft = useCallback(() => {
    setLeftCollapsed(true)
  }, [])

  const expandRight = useCallback(() => {
    setRightCollapsed(false)
  }, [])

  const collapseRight = useCallback(() => {
    setRightCollapsed(true)
  }, [])

  return {
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    expandLeft,
    collapseLeft,
    expandRight,
    collapseRight,
    onLeftHandleMouseDown,
    onRightHandleMouseDown,
    isDraggingLeft,
    isDraggingRight,
    containerRef,
  }
}
