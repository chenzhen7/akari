/** 统一为 '/' 分隔 */
export function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 拼接相对路径段；根目录返回 ''（去掉首尾 '/'），空段跳过 */
export function joinRelPath(...segments: Array<string | undefined>): string {
  return segments
    .filter((s): s is string => !!s)
    .map(normalizeRelPath)
    .join('/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/** 返回父目录相对路径；无父目录返回 '' */
export function dirnameRelPath(p: string): string {
  const n = normalizeRelPath(p).replace(/\/+$/, '')
  const idx = n.lastIndexOf('/')
  return idx <= 0 ? '' : n.slice(0, idx)
}

/** 返回最后一段名称 */
export function basenameRelPath(p: string): string {
  const n = normalizeRelPath(p).replace(/\/+$/, '')
  const idx = n.lastIndexOf('/')
  return idx < 0 ? n : n.slice(idx + 1)
}
