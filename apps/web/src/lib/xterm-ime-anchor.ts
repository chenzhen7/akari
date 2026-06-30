import type { Terminal, IBufferCell } from '@xterm/xterm'

interface Detached {
  detach(): void
}

interface PinnedPosition {
  left: string
  top: string
  width: string
  height: string
  lineHeight: string
}

/**
 * Reposition xterm.js IME elements onto the visible TUI caret.
 *
 * xterm.js anchors the IME preedit and candidate window at the hardware cursor
 * position. That works for normal shells, but Ink-style TUIs (Claude Code,
 * etc.) hide the real cursor and render a fake caret as an isolated inverse or
 * background-colored cell. This helper detects that fake caret during
 * composition and pins the `.xterm-helper-textarea` and `.composition-view`
 * elements to its pixel position.
 *
 * If no fake caret is found, the helper falls back to xterm.js's default
 * hardware-cursor anchor.
 */
export function attachImeAnchor(terminal: Terminal): Detached {
  const root = terminal.element
  if (root === undefined) {
    return { detach() {} }
  }

  const textarea = root.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
  const screen = root.querySelector<HTMLElement>('.xterm-screen')
  const compositionView = root.querySelector<HTMLElement>('.composition-view')

  if (textarea === null || screen === null || compositionView === null) {
    return { detach() {} }
  }

  let composing = false
  let pinned: PinnedPosition | null = null
  let renderDisposable: { dispose(): void } | null = null

  const reapply = (element: HTMLElement) => {
    if (!composing || pinned === null) return
    if (
      element.style.left !== pinned.left ||
      element.style.top !== pinned.top ||
      element.style.width !== pinned.width ||
      element.style.height !== pinned.height
    ) {
      element.style.setProperty('left', pinned.left, 'important')
      element.style.setProperty('top', pinned.top, 'important')
      element.style.setProperty('width', pinned.width, 'important')
      element.style.setProperty('height', pinned.height, 'important')
      element.style.setProperty('line-height', pinned.lineHeight, 'important')
    }
  }

  const textareaObserver = new MutationObserver(() => reapply(textarea))
  const compositionObserver = new MutationObserver(() => reapply(compositionView))

  function computeCellSize(): { width: number; height: number } {
    const rect = screen.getBoundingClientRect()
    return {
      width: rect.width / Math.max(terminal.cols, 1),
      height: rect.height / Math.max(terminal.rows, 1),
    }
  }

  function isCaretCell(cell: IBufferCell): boolean {
    // Claude Code's default fake caret uses chalk.inverse().
    // Some patched/custom builds use a non-default background color instead.
    return cell.isInverse() !== 0 || (cell.isBgDefault() === false && cell.getChars().trim() === '')
  }

  function findCaretCell(): { col: number; row: number; width: number } | null {
    const buffer = terminal.buffer.active
    const rows = terminal.rows
    const startY = buffer.viewportY

    // Right-to-left, bottom-up: prefer the most recently drawn caret indicator.
    for (let y = startY + rows - 1; y >= startY; y--) {
      const line = buffer.getLine(y)
      if (line === undefined) continue

      for (let x = line.length - 1; x >= 0; x--) {
        const cell = line.getCell(x)
        if (cell === undefined || !isCaretCell(cell)) continue

        const left = x > 0 ? line.getCell(x - 1) : undefined
        const right = x + 1 < line.length ? line.getCell(x + 1) : undefined
        const leftCaret = left !== undefined && isCaretCell(left)
        const rightCaret = right !== undefined && isCaretCell(right)
        // Skip decorative styled runs (e.g. selected menu rows).
        if (leftCaret && rightCaret) continue

        // Caret width in cells (wide chars occupy 2 columns).
        const width = Math.max(cell.getWidth(), 1)
        return { col: x, row: y - startY, width }
      }
    }
    return null
  }

  function applyPin(left: string, top: string, width: string, height: string, lineHeight: string): void {
    pinned = { left, top, width, height, lineHeight }
    textarea.style.setProperty('left', left, 'important')
    textarea.style.setProperty('top', top, 'important')
    textarea.style.setProperty('width', width, 'important')
    textarea.style.setProperty('height', height, 'important')
    textarea.style.setProperty('line-height', lineHeight, 'important')
    compositionView.style.setProperty('left', left, 'important')
    compositionView.style.setProperty('top', top, 'important')
    compositionView.style.setProperty('width', width, 'important')
    compositionView.style.setProperty('height', height, 'important')
    compositionView.style.setProperty('line-height', lineHeight, 'important')
  }

  function recomputeAndPin(): void {
    if (!composing) return

    const hit = findCaretCell()
    if (hit === null) {
      // Keep the previous anchor during transient redraws; do not reset here.
      return
    }

    const { width: cellW, height: cellH } = computeCellSize()
    const left = `${Math.round(hit.col * cellW)}px`
    const top = `${Math.round(hit.row * cellH)}px`
    const width = `${Math.round(hit.width * cellW)}px`
    const height = `${Math.round(cellH)}px`
    const lineHeight = height

    if (
      pinned !== null &&
      pinned.left === left &&
      pinned.top === top &&
      pinned.width === width
    ) {
      return
    }

    applyPin(left, top, width, height, lineHeight)
  }

  function onCompositionStart(): void {
    composing = true

    const hit = findCaretCell()
    if (hit !== null) {
      const { width: cellW, height: cellH } = computeCellSize()
      const left = `${Math.round(hit.col * cellW)}px`
      const top = `${Math.round(hit.row * cellH)}px`
      const width = `${Math.round(hit.width * cellW)}px`
      const height = `${Math.round(cellH)}px`
      const lineHeight = height
      applyPin(left, top, width, height, lineHeight)
    }

    // Follow subsequent renders to handle partial commits and caret movement
    // mid-composition.
    renderDisposable = terminal.onRender(() => {
      recomputeAndPin()
    })
  }

  function onCompositionEnd(): void {
    composing = false
    pinned = null
    renderDisposable?.dispose()
    renderDisposable = null
    // Let xterm.js take its natural position back on the next cursor tick.
  }

  textarea.addEventListener('compositionstart', onCompositionStart)
  textarea.addEventListener('compositionend', onCompositionEnd)

  textareaObserver.observe(textarea, {
    attributes: true,
    attributeFilter: ['style'],
  })
  compositionObserver.observe(compositionView, {
    attributes: true,
    attributeFilter: ['style'],
  })

  return {
    detach() {
      composing = false
      pinned = null
      renderDisposable?.dispose()
      renderDisposable = null
      textarea.removeEventListener('compositionstart', onCompositionStart)
      textarea.removeEventListener('compositionend', onCompositionEnd)
      textareaObserver.disconnect()
      compositionObserver.disconnect()
    },
  }
}
