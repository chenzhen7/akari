import { describe, it, expect } from 'vitest'
import { API_BASE } from '@/shared/lib/api'
import { dirnameOf, joinPosix, resolveMarkdownImageSrc } from './markdown-image-utils'

const SID = 'sess-1'
const WS = 'ws-1'
const rawUrl = (path: string) =>
  `${API_BASE}/sessions/${SID}/raw-file?path=${encodeURIComponent(path)}&workspaceId=${WS}`

describe('dirnameOf', () => {
  it('根目录文件返回空串', () => {
    expect(dirnameOf('README.md')).toBe('')
  })

  it('返回目录部分', () => {
    expect(dirnameOf('docs/a/b.md')).toBe('docs/a')
  })
})

describe('joinPosix', () => {
  it('拼接并清理空段与 ./', () => {
    expect(joinPosix('docs', './images/a.png')).toBe('docs/images/a.png')
  })

  it('清理 ../ 并钳制在根目录', () => {
    expect(joinPosix('docs', '../images/a.png')).toBe('images/a.png')
    expect(joinPosix('', '../a.png')).toBe('a.png')
    expect(joinPosix('a/b', '../../../../escape.png')).toBe('escape.png')
  })
})

describe('resolveMarkdownImageSrc', () => {
  it('相对路径按文件所在目录解析', () => {
    expect(resolveMarkdownImageSrc('./images/logo.png', 'README.md', SID, WS)).toBe(rawUrl('images/logo.png'))
    expect(resolveMarkdownImageSrc('images/logo.png', 'docs/guide.md', SID, WS)).toBe(rawUrl('docs/images/logo.png'))
  })

  it('跨目录 ../ 正确上溯', () => {
    expect(resolveMarkdownImageSrc('../assets/b.png', 'docs/guide.md', SID, WS)).toBe(rawUrl('assets/b.png'))
  })

  it('以 / 开头按 session 根解析', () => {
    expect(resolveMarkdownImageSrc('/img/a.png', 'docs/guide.md', SID, WS)).toBe(rawUrl('img/a.png'))
  })

  it('剥离 ?query 与 #hash', () => {
    expect(resolveMarkdownImageSrc('./a.png?v=1', 'README.md', SID, WS)).toBe(rawUrl('a.png'))
    expect(resolveMarkdownImageSrc('./a.png#frag', 'README.md', SID, WS)).toBe(rawUrl('a.png'))
  })

  it('外部链接 / 锚点 / 空值不重写', () => {
    expect(resolveMarkdownImageSrc('https://example.com/x.png', 'README.md', SID, WS)).toBeNull()
    expect(resolveMarkdownImageSrc('data:image/png;base64,xxx', 'README.md', SID, WS)).toBeNull()
    expect(resolveMarkdownImageSrc('#section', 'README.md', SID, WS)).toBeNull()
    expect(resolveMarkdownImageSrc('', 'README.md', SID, WS)).toBeNull()
  })
})
