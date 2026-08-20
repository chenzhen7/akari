import hljs from 'highlight.js'

/** 扩展名 → highlight.js 语言名（仅覆盖常用类型，未命中时返回 null 退化为纯文本） */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  lua: 'lua',
  diff: 'diff',
}

export function getLanguageForFile(filePath: string): string | null {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  // Dockerfile / Makefile 这类无扩展名文件
  const lowerName = fileName.toLowerCase()
  if (lowerName === 'dockerfile') return 'dockerfile'
  if (lowerName === 'makefile' || lowerName === 'gnumakefile') return 'makefile'
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return null
  const ext = fileName.slice(dotIndex + 1).toLowerCase()
  const language = EXTENSION_LANGUAGE_MAP[ext]
  if (!language) return null
  return hljs.getLanguage(language) ? language : null
}

/**
 * 把 hljs 输出的 HTML 按换行符拆成逐行 HTML。
 * hljs 的 <span> 标签可能跨行（多行字符串/注释），拆行时在行尾补齐未闭合标签、
 * 下一行重新打开，保证每行 HTML 独立可渲染。
 */
function splitHighlightedHtml(html: string): string[] {
  const lines: string[] = []
  const openTags: string[] = []
  let current = ''
  let i = 0
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const end = html.indexOf('>', i)
      if (end === -1) {
        current += html.slice(i)
        break
      }
      const tag = html.slice(i, end + 1)
      if (tag.startsWith('</')) {
        openTags.pop()
      } else {
        openTags.push(tag)
      }
      current += tag
      i = end + 1
    } else if (ch === '\n') {
      const closing = [...openTags].reverse().map(() => '</span>').join('')
      lines.push(current + closing)
      current = openTags.join('')
      i++
    } else {
      current += ch
      i++
    }
  }
  lines.push(current)
  return lines
}

/**
 * 对一组代码行做语法高亮，返回与输入等长的逐行 HTML 数组。
 * 无匹配语言或高亮失败时返回 null，调用方退化为纯文本渲染。
 * （hljs 内部会先转义源码，返回的 HTML 可安全用于 dangerouslySetInnerHTML。）
 */
export function highlightCodeLines(lines: string[], filePath: string): string[] | null {
  const language = getLanguageForFile(filePath)
  if (!language) return null
  const result = hljs.highlight(lines.join('\n'), { language, ignoreIllegals: true })
  const split = splitHighlightedHtml(result.value)
  if (split.length !== lines.length) return null
  return split
}
