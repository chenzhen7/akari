/**
 * 源码行 ↔ 预览元素 精确双向映射，移植自 VSCode markdown 预览的
 * `extensions/markdown-language-features/preview-src/scroll-sync.ts` 算法：
 * - 每个块级元素带 `data-line`（源码起始行号），代码块另算 endLine
 * - 双向都用「比例插值」精确定位（代码块内部按行数、元素间距按像素比例），
 *   而不是只跳标题，因此往返切换不会累积漂移
 *
 * 所有坐标均为滚动容器内容坐标（0 = 内容顶部），与容器当前 scrollTop 无关。
 */

export interface CodeLineEntry {
  element: HTMLElement
  line: number
  codeElement?: HTMLElement
  endLine?: number
}

function isVisible(entry: CodeLineEntry): boolean {
  // 用 display/visibility 判断（jsdom 无布局、getBoundingClientRect 恒为 0，无法用尺寸判断）
  const style = window.getComputedStyle(entry.element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/** 收集容器内所有带 data-line 的块元素（按文档顺序） */
export function collectCodeLineElements(container: HTMLElement): CodeLineEntry[] {
  const entries: CodeLineEntry[] = [{ element: container, line: -1 }]
  for (const el of container.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = Number(el.getAttribute('data-line'))
    if (!Number.isFinite(line)) continue
    if (el.tagName === 'PRE') {
      // 代码块：data-line 在 <pre> 上，endLine 由代码文本换行数推算
      const code = el.querySelector('code')
      const text = code?.textContent ?? el.textContent ?? ''
      const lineCount = (text.match(/\n/g) ?? []).length + 1
      entries.push({ element: el, line, codeElement: code ?? undefined, endLine: line + lineCount - 1 })
    } else if (el.tagName === 'UL' || el.tagName === 'OL') {
      // 跳过列表容器，优先用 li 作锚点（避免同行的重复项）
    } else {
      entries.push({ element: el, line })
    }
  }
  return entries
}

/** 元素在容器内容坐标中的 top */
function getElementTopInContainer(entry: CodeLineEntry, container: HTMLElement): number {
  const containerRect = container.getBoundingClientRect()
  const elRect = entry.element.getBoundingClientRect()
  return container.scrollTop + (elRect.top - containerRect.top)
}

function getElementBounds(entry: CodeLineEntry, container: HTMLElement): { top: number; height: number } {
  const top = getElementTopInContainer(entry, container)
  const elRect = entry.element.getBoundingClientRect()
  let height = elRect.height
  // 内部若还嵌套了带 data-line 的块（如 blockquote>p），高度截断到第一个子块，避免重叠
  const child = entry.element.querySelector<HTMLElement>('[data-line]')
  if (child) {
    const childTop = getElementTopInContainer({ element: child }, container)
    height = Math.max(1, childTop - top)
  }
  return { top, height }
}

/** 代码块内容区（扣除 padding），其余元素即自身 bounds */
function getContentBounds(entry: CodeLineEntry, container: HTMLElement): { top: number; height: number } {
  if (entry.codeElement) {
    const style = window.getComputedStyle(entry.element)
    const paddingTop = parseFloat(style.paddingTop) || 0
    const paddingBottom = parseFloat(style.paddingBottom) || 0
    const bounds = getElementBounds(entry, container)
    return { top: bounds.top + paddingTop, height: Math.max(0, bounds.height - paddingTop - paddingBottom) }
  }
  return getElementBounds(entry, container)
}

/** 找到目标行对应的元素：精确匹配返回单个，否则返回其前后相邻的两个 */
export function getElementsForSourceLine(targetLine: number, entries: CodeLineEntry[]): {
  previous: CodeLineEntry
  next?: CodeLineEntry
} {
  const lineNumber = Math.floor(targetLine)
  let previous = entries[0]
  for (const entry of entries) {
    if (entry.line === lineNumber) return { previous: entry, next: undefined }
    if (entry.line > lineNumber) return { previous, next: entry }
    previous = entry
  }
  return { previous }
}

/** 定位 offset（内容坐标）处的元素：命中返回单个，否则返回前后相邻 */
function getLineElementsAtOffset(
  offset: number,
  entries: CodeLineEntry[],
  container: HTMLElement,
): { previous: CodeLineEntry; next?: CodeLineEntry } {
  const visible = entries.filter(isVisible)
  let previous = visible[0]
  for (const entry of visible) {
    const bounds = getElementBounds(entry, container)
    if (bounds.top <= offset) {
      previous = entry
      if (bounds.top + bounds.height > offset) return { previous }
    } else {
      return { previous, next: entry }
    }
  }
  return { previous }
}

/** 预览顶部对应的源码行号（精确到小数） */
export function getEditorLineNumberForPageOffset(
  container: HTMLElement,
  offset: number,
  entries: CodeLineEntry[],
): number | null {
  const { previous, next } = getLineElementsAtOffset(offset, entries, container)
  if (!previous) return null
  if (previous.line < 0) return 1
  const prevBounds = getElementBounds(previous, container)
  const offsetFromPrevious = offset - prevBounds.top

  if (previous.endLine && previous.endLine > previous.line) {
    const contentBounds = getContentBounds(previous, container)
    const offsetFromContent = offset - contentBounds.top
    if (offsetFromContent >= 0 && offsetFromContent <= contentBounds.height) {
      const progress = contentBounds.height > 0 ? offsetFromContent / contentBounds.height : 0
      return previous.line + progress * (previous.endLine - previous.line)
    }
    if (next && offsetFromContent > contentBounds.height) {
      const gapOffset = offsetFromContent - contentBounds.height
      const nextTop = getElementTopInContainer(next, container)
      const contentEnd = contentBounds.top + contentBounds.height
      const gapHeight = nextTop - contentEnd
      const progress = gapHeight > 0 ? gapOffset / gapHeight : 0
      return previous.endLine + progress * (next.line - previous.endLine)
    }
  }

  if (next) {
    const nextTop = getElementTopInContainer(next, container)
    const range = nextTop - prevBounds.top
    const progress = range > 0 ? offsetFromPrevious / range : 0
    return previous.line + progress * (next.line - previous.line)
  }
  const progress = prevBounds.height > 0 ? offsetFromPrevious / prevBounds.height : 0
  return previous.line + progress
}

/** 把源码行滚动到预览对应位置（精确插值） */
export function scrollToRevealSourceLine(container: HTMLElement, line: number, entries: CodeLineEntry[]): void {
  if (line <= 0) {
    container.scrollTop = 0
    return
  }
  const { previous, next } = getElementsForSourceLine(line, entries)
  if (!previous) return
  if (previous.line < 0) {
    // 目标行在首个块元素之前 → 滚到首个元素上方附近
    const scrollTo = next ? Math.max(1, getElementTopInContainer(next, container) - 40) : 0
    container.scrollTop = scrollTo
    return
  }

  const prevBounds = getElementBounds(previous, container)
  const previousTop = prevBounds.top
  let scrollTo = 0

  if (previous.endLine && previous.endLine > previous.line) {
    if (line < previous.endLine) {
      // 在代码块内部：按行数在其内容区（扣除 padding）内比例定位
      const contentBounds = getContentBounds(previous, container)
      const progress = (line - previous.line) / (previous.endLine - previous.line)
      scrollTo = contentBounds.top + contentBounds.height * progress
    } else if (next && next.line !== previous.line) {
      const betweenProgress = (line - previous.endLine) / (next.line - previous.endLine)
      const elementEnd = previousTop + prevBounds.height
      const nextTop = getElementTopInContainer(next, container)
      scrollTo = elementEnd + betweenProgress * (nextTop - elementEnd)
    } else {
      scrollTo = previousTop + prevBounds.height
    }
  } else if (next && next.line !== previous.line) {
    // 在两个元素之间：按像素比例插值
    const betweenProgress = (line - previous.line) / (next.line - previous.line)
    const elementEnd = previousTop + prevBounds.height
    const nextTop = getElementTopInContainer(next, container)
    scrollTo = elementEnd + betweenProgress * (nextTop - elementEnd)
  } else {
    const progressInElement = line - Math.floor(line)
    scrollTo = previousTop + prevBounds.height * progressInElement
  }
  container.scrollTop = Math.max(1, scrollTo)
}
