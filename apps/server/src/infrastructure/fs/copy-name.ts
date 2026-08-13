/**
 * 复制/移动冲突时的自动改名助手（VSCode 'simple' 递增命名）。
 * 目录不拆扩展名；dotfile（如 .gitignore）视为无扩展名。
 */

/** 拆分 basename 为「主干 + 扩展名」。目录或 dotfile 扩展名为空。 */
export function splitCopyName(name: string, isDirectory: boolean): { stem: string; ext: string } {
  if (isDirectory) return { stem: name, ext: '' }
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, idx), ext: name.slice(idx) }
}

/** 第 1 份 → `name copy`；第 n 份 → `name copy {n}` */
export function buildCopyName(stem: string, ext: string, n: number): string {
  return n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`
}
