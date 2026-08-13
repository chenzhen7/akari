import { API_BASE } from '@/shared/lib/api'

/** 外部协议（http/https/data/mailto/# 锚点）或网络路径（//）不重写 */
const EXTERNAL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** 返回相对路径的目录部分（posix），文件在根目录时返回空串 */
export function dirnameOf(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx > 0 ? filePath.slice(0, idx) : ''
}

/** posix 风格路径拼接 + 归一化：清理 './' 与空段，'../' 上溯并钳制在根目录 */
export function joinPosix(...segments: string[]): string {
  const parts: string[] = []
  for (const segment of segments) {
    if (!segment) continue
    for (const part of segment.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        parts.pop()
      } else {
        parts.push(part)
      }
    }
  }
  return parts.join('/')
}

/**
 * 把 markdown 里的图片 src 解析为后端 raw-file 接口地址。
 * 返回 null 表示无需重写（外部链接 / 锚点 / 空值），由 react-markdown 默认处理。
 *
 * - 以 `/` 开头 → session 根目录相对，strip 前导 `/`
 * - 相对路径 → 相对 markdown 文件所在目录解析（`dirnameOf(filePath)` + src）
 * - 剥离 src 中的 `?query` 与 `#hash`（本地文件上无意义）
 *
 * 后端对非静态路由有全局 workspace 校验（X-Workspace-Id 头或 workspaceId 查询参数）。
 * 浏览器 `<img>` 无法自定义请求头，因此把 workspaceId 拼进查询参数。
 */
export function resolveMarkdownImageSrc(
  src: string,
  filePath: string,
  sessionId: string,
  workspaceId: string,
): string | null {
  if (!src) return null
  if (EXTERNAL_PATTERN.test(src)) return null

  const hashIdx = src.indexOf('#')
  const queryIdx = src.indexOf('?')
  const cut =
    hashIdx >= 0 && queryIdx >= 0
      ? Math.min(hashIdx, queryIdx)
      : hashIdx >= 0
        ? hashIdx
        : queryIdx
  const pathPart = cut >= 0 ? src.slice(0, cut) : src
  if (!pathPart) return null

  const resolved = pathPart.startsWith('/')
    ? pathPart.replace(/^\/+/, '')
    : joinPosix(dirnameOf(filePath), pathPart)

  const params = new URLSearchParams({
    path: resolved,
    workspaceId,
  })
  return `${API_BASE}/sessions/${sessionId}/raw-file?${params.toString()}`
}
