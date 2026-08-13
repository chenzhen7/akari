import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownPreview, type MarkdownPreviewHandle } from './MarkdownPreview'

const SID = 'sess-1'

describe('MarkdownPreview', () => {
  it('渲染标题、段落、列表', () => {
    render(<MarkdownPreview content={'# 标题\n\n正文内容\n\n- 列表项'} filePath="README.md" sessionId={SID} workspaceId="ws-1" />)
    expect(screen.getByRole('heading', { level: 1, name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('正文内容')).toBeInTheDocument()
    expect(screen.getByText('列表项')).toBeInTheDocument()
  })

  it('remark-gfm 渲染表格', () => {
    render(
      <MarkdownPreview
        content={'| 列A | 列B |\n| --- | --- |\n| 1 | 2 |'}
        filePath="README.md"
        sessionId={SID}
      />,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('列A')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('rehype-highlight 给带语言代码块加 hljs 类', () => {
    const { container } = render(
      <MarkdownPreview
        content={'```ts\nconst x = 1\n```'}
        filePath="README.md"
        sessionId={SID}
      />,
    )
    expect(container.querySelector('pre')).not.toBeNull()
    const code = container.querySelector('pre code')
    expect(code?.className).toContain('hljs')
    expect(code?.className).toContain('language-ts')
  })

  it('相对图片重写为 raw-file 接口地址', () => {
    const { container } = render(
      <MarkdownPreview
        content={'![](./images/logo.png)'}
        filePath="docs/guide.md"
        sessionId={SID}
        workspaceId="ws-1"
      />,
    )
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe(`/sessions/${SID}/raw-file?path=docs%2Fimages%2Flogo.png&workspaceId=ws-1`)
  })

  it('外部 http 图片原样保留', () => {
    const { container } = render(
      <MarkdownPreview
        content={'![](https://example.com/a.png)'}
        filePath="README.md"
        sessionId={SID}
        workspaceId="ws-1"
      />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
  })

  it('内联 HTML 按 GitHub 规则渲染并净化（script 与事件被剥离）', () => {
    render(
      <MarkdownPreview
        content={'<script>alert(1)</script><b onclick="x()">xss</b>'}
        filePath="README.md"
        sessionId={SID}
        workspaceId="ws-1"
      />,
    )
    // script 被净化剥除
    expect(document.querySelector('script')).toBeNull()
    // b 是合法标签，正常渲染
    expect(document.querySelector('b')?.textContent).toBe('xss')
    // 事件属性被净化剥除
    expect(document.querySelector('b')?.getAttribute('onclick')).toBeNull()
  })

  it('渲染 GitHub README 风格 HTML（居中 logo + 相对图片）', () => {
    const { container } = render(
      <MarkdownPreview
        content={'<p align="center"><img src="apps/desktop/build/icon.png" width="120" alt="Akari logo" /></p>'}
        filePath="README.md"
        sessionId={SID}
        workspaceId="ws-1"
      />,
    )
    const p = container.querySelector('p[align="center"]')
    expect(p).not.toBeNull()
    const img = p?.querySelector('img')
    expect(img?.getAttribute('src')).toBe(`/sessions/${SID}/raw-file?path=apps%2Fdesktop%2Fbuild%2Ficon.png&workspaceId=ws-1`)
    expect(img?.getAttribute('alt')).toBe('Akari logo')
  })

  it('标题注入 data-line 源码行号（供位置同步）', () => {
    const { container } = render(
      <MarkdownPreview content={'# 标题\n\n## 小节'} filePath="README.md" sessionId={SID} workspaceId="ws-1" />,
    )
    expect(container.querySelector('h1')?.getAttribute('data-line')).toBe('1')
    expect(container.querySelector('h2')?.getAttribute('data-line')).toBe('3')
  })

  it('所有块级元素注入 data-line（源码行号，供精确滚动映射）', () => {
    const { container } = render(
      <MarkdownPreview
        content={'# 标题\n\n正文段落\n\n```ts\nconst x = 1\n```'}
        filePath="README.md"
        sessionId={SID}
        workspaceId="ws-1"
      />,
    )
    expect(container.querySelector('h1')?.getAttribute('data-line')).toBe('1')
    expect(container.querySelector('p')?.getAttribute('data-line')).toBe('3')
    expect(container.querySelector('pre')?.getAttribute('data-line')).toBe('5')
  })

  it('位置同步 handle：精确映射定位与回读', () => {
    const ref = createRef<MarkdownPreviewHandle>()
    const { container } = render(
      <MarkdownPreview ref={ref} content={'# A\n\n# B'} filePath="README.md" sessionId={SID} workspaceId="ws-1" />,
    )
    const handle = ref.current
    expect(handle).not.toBeNull()
    // jsdom 无真实布局：所有元素 getBoundingClientRect 为 0，顶部回读返回最后一个块元素行
    expect(handle?.getCurrentSourceLine()).toBe(3)
    expect(() => handle?.scrollToSourceLine(2)).not.toThrow()
    const el = container.querySelector<HTMLElement>('.markdown-preview')
    expect(el?.scrollTop).toBeGreaterThanOrEqual(0)
  })

  it('代码块为 GitHub 风格：pre + 复制按钮 + 完整代码文本', () => {
    const { container } = render(
      <MarkdownPreview
        content={'```ts\nconst x: number = 1\n```'}
        filePath="README.md"
        sessionId={SID}
        workspaceId="ws-1"
      />,
    )
    expect(container.querySelector('.code-block pre')).not.toBeNull()
    expect(container.querySelector('.code-block pre code')?.className).toContain('hljs')
    expect(container.querySelector('button[aria-label="复制代码"]')).not.toBeNull()
    expect(container.querySelector('.code-block')?.textContent).toContain('const x: number = 1')
  })
})
