/**
 * rehype 插件：给所有块级元素注入 `data-line` 属性，值为源码起始行号。
 *
 * 参考 VSCode markdown 预览的 scroll-sync 设计：markdown-it 给每个块级 token
 * 打上 `data-line`，前端据此建立「源码行 ↔ 预览元素」的精确映射，实现双向滚动同步。
 * 这里用 rehype 在渲染管线内给块级元素写入同样的属性（position 即源码位置）。
 */

/** markdown-it 会为这些块级 token 生成对应的块元素 */
const BLOCK_TAGS = new Set([
  'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'pre', 'hr',
  'table', 'thead', 'tbody', 'tr',
  'figure', 'figcaption', 'details', 'summary',
  'section', 'div',
])

interface NodeLike {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  position?: { start?: { line?: number } }
  children?: NodeLike[]
}

export function rehypeDataLine() {
  return (tree: NodeLike) => {
    const visit = (node: NodeLike) => {
      if (node.type === 'element') {
        const tag = (node.tagName ?? '').toLowerCase()
        const line = node.position?.start?.line
        if (line != null && BLOCK_TAGS.has(tag) && node.properties) {
          node.properties['data-line'] = line
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
