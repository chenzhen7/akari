import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { resolveMarkdownImageSrc } from '../lib/markdown-image-utils'
import { rehypeDataLine } from '../lib/rehype-data-line'
import { collectCodeLineElements, getEditorLineNumberForPageOffset, scrollToRevealSourceLine, type CodeLineEntry } from '../lib/scroll-sync'
import { CodeBlock } from './CodeBlock'

export interface MarkdownPreviewHandle {
  /** 把源码行滚动到预览对应位置（精确插值，参考 VSCode scroll-sync） */
  scrollToSourceLine(line: number): void
  /** 返回预览顶部对应的源码行号（精确到小数） */
  getCurrentSourceLine(): number | null
}

interface MarkdownPreviewProps {
  content: string
  filePath: string
  sessionId: string
  workspaceId: string
}

// ── hast 节点（react-markdown passNode 传入）的文本提取 ────────────────────

interface HastNodeLike {
  type?: string
  value?: string
  children?: HastNodeLike[]
  properties?: Record<string, unknown>
}

function isHastNode(value: unknown): value is HastNodeLike {
  return typeof value === 'object' && value !== null && 'type' in value
}

/** 递归拼接 hast 子树文本（highlight.js 会把代码拆成多个 token 元素） */
function extractHastText(node: HastNodeLike | undefined): string {
  if (!node) return ''
  if (typeof node.value === 'string') return node.value
  if (Array.isArray(node.children)) return node.children.map(extractHastText).join('')
  return ''
}

/** 从 hast 的 <pre> 节点提取纯代码文本（供复制按钮） */
function extractCodeTextFromPre(preNode: HastNodeLike | undefined): string {
  const firstChild = Array.isArray(preNode?.children) ? preNode.children[0] : undefined
  const codeNode = isHastNode(firstChild) ? firstChild : undefined
  // extractHastText 接受单个节点并递归拼接其 children；codeNode 即 <code> 元素
  return extractHastText(codeNode)
}

/**
 * Markdown 渲染预览。内联 HTML（GitHub README 风格）经 rehype-raw 解析、
 * rehype-sanitize 按 GitHub 规则净化（剥除 script / on* 事件 / javascript: 等），
 * 再 rehype-highlight 高亮代码块（顺序确保 hljs 类不被净化剥掉）。
 * 滚动同步：rehypeDataLine 给块级元素打 data-line，scroll-sync 建立精确双向映射。
 */
export const MarkdownPreview = memo(
  forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(function MarkdownPreview(
    { content, filePath, sessionId, workspaceId },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const entriesRef = useRef<CodeLineEntry[]>([])

    // 内容变化时重建「源码行 ↔ 预览元素」映射
    useLayoutEffect(() => {
      const container = containerRef.current
      if (!container) return
      entriesRef.current = collectCodeLineElements(container)
    }, [content])

    useImperativeHandle(ref, () => ({
      scrollToSourceLine(line) {
        const container = containerRef.current
        if (!container) return
        scrollToRevealSourceLine(container, line, entriesRef.current)
      },
      getCurrentSourceLine() {
        const container = containerRef.current
        if (!container) return null
        return getEditorLineNumberForPageOffset(container, container.scrollTop + 4, entriesRef.current)
      },
    }))

    return (
      <div ref={containerRef} className="markdown-preview h-full overflow-y-auto">
        {/* github-markdown-css 提供 GitHub 同款渲染，min-h-full 让背景铺满；
            select-text 覆盖 AppShell 根容器的 select-none，保证内容可选中 */}
        <div className="markdown-body min-h-full select-text px-8 py-6">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeHighlight, rehypeDataLine]}
            components={{
              // 相对图片重写为后端 raw-file 接口地址，外部链接原样保留
              img: ({ src, alt, node, ...rest }) => {
                void node // react-markdown 注入的 hast 节点，不透传给 DOM <img>
                return <img src={resolveMarkdownImageSrc(src ?? '', filePath, sessionId, workspaceId) ?? src} alt={alt} {...rest} />
              },
              // 代码块：GitHub 风格（外观由 markdown-body pre 提供 + 复制按钮）
              // data-line 从 hast 节点透传，供滚动同步映射（rehypeDataLine 已注入）
              pre: ({ children, node }) => {
                const rawLine = (node as HastNodeLike | undefined)?.properties?.['data-line']
                const dataLine = typeof rawLine === 'number' ? rawLine : undefined
                return (
                  <CodeBlock code={extractCodeTextFromPre(node)} dataLine={dataLine}>
                    {children}
                  </CodeBlock>
                )
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    )
  }),
)
