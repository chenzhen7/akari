import { describe, it, expect } from 'vitest'
import { OscTitleParser } from '../infrastructure/pty/osc-title-parser.js'

describe('OscTitleParser', () => {
  it('解析单个 chunk 内 BEL 终止的 OSC 0 标题', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;My Session\x07')).toEqual(['My Session'])
  })

  it('解析单个 chunk 内 ESC\\ 终止的 OSC 2 标题', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]2;Window Title\x1b\\')).toEqual(['Window Title'])
  })

  it('解析 OSC 1（图标标题）', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]1;Icon\x07')).toEqual(['Icon'])
  })

  it('解析跨 chunk 拆分的 OSC 序列', () => {
    const parser = new OscTitleParser()
    expect(parser.push('hello\x1b]0;Cl')).toEqual([])
    expect(parser.push('aude Code\x07')).toEqual(['Claude Code'])
  })

  it('解析单个 chunk 内多个 OSC 序列', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;First\x07\x1b]2;Second\x1b\\')).toEqual(['First', 'Second'])
  })

  it('忽略空标题（shell 恢复默认）', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;\x07')).toEqual([])
  })

  it('忽略非标题的 OSC 序列（如 OSC 3）', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]3;Ignored\x07')).toEqual([])
  })

  it('忽略普通输出', () => {
    const parser = new OscTitleParser()
    expect(parser.push('plain text without osc')).toEqual([])
  })

  it('剥离标题中的控制字符（含嵌套 ESC）', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;A\x01B\x1bC\x07')).toEqual(['ABC'])
  })

  it('trim 标题首尾空白', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;  Hello  \x07')).toEqual(['Hello'])
  })

  it('截断超长标题', () => {
    const parser = new OscTitleParser()
    const long = 'x'.repeat(200)
    const result = parser.push(`\x1b]0;${long}\x07`)
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(80)
  })

  it('畸形 OSC（无分号）被消费且不影响后续序列', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0\x07then \x1b]0;Real\x07')).toEqual(['Real'])
  })

  it('跨 chunk 的尾部孤立 ESC 不产生假标题', () => {
    const parser = new OscTitleParser()
    expect(parser.push('abc\x1b')).toEqual([])
    expect(parser.push('[31mred')).toEqual([])
  })

  it('分号之后标题跨 chunk，终止符在下一个 chunk', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;Claude')).toEqual([])
    expect(parser.push(' Code\x1b\\')).toEqual(['Claude Code'])
  })

  it('终止符 ESC\\ 恰在 chunk 边界', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;Split')).toEqual([])
    expect(parser.push('\x1b\\after')).toEqual(['Split'])
  })

  it('标题内含分号时仅首个分号作为分隔符', () => {
    const parser = new OscTitleParser()
    expect(parser.push('\x1b]0;Foo;Bar\x07')).toEqual(['Foo;Bar'])
  })
})
