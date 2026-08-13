import type { FileDiffLine } from '@akari/shared-types'

/** 一个可点击/导航的行级差异点。removed 块在 FileDiffLine 中多行共用同一锚点，此处按锚点去重。 */
export interface QuickDiffChange {
  id: string
  lineNumber: number
  type: FileDiffLine['type']
}

export interface GutterPalette {
  added: string
  modified: string
  deleted: string
  overview: { added: string; modified: string; deleted: string }
  minimap: { added: string; modified: string; deleted: string }
}

/**
 * gutter / overview ruler / minimap 颜色，取自 VSCode common/quickDiff.ts
 * （editorGutter.addedBackground 等令牌的 dark/light 默认值）。
 */
export const GUTTER_COLORS: Record<'dark' | 'light', GutterPalette> = {
  dark: {
    added: '#487e02',
    modified: '#1b81a8',
    deleted: '#f14c4c',
    overview: {
      added: 'rgba(72, 126, 2, 0.6)',
      modified: 'rgba(27, 129, 168, 0.6)',
      deleted: 'rgba(241, 76, 76, 0.6)',
    },
    minimap: { added: '#487e02', modified: '#1b81a8', deleted: '#f14c4c' },
  },
  light: {
    added: '#48985d',
    modified: '#2090d3',
    deleted: '#b5200d',
    overview: {
      added: 'rgba(72, 152, 93, 0.6)',
      modified: 'rgba(32, 144, 211, 0.6)',
      deleted: 'rgba(181, 32, 13, 0.6)',
    },
    minimap: { added: '#48985d', modified: '#2090d3', deleted: '#b5200d' },
  },
}

/**
 * 将 diff-lines 列表转成去重、行号合法的变更点列表。
 * - removed 块多行共用同一锚点，只保留第一个；
 * - 删除在文件头时锚点可能为 0，Monaco 行号从 1 起，clamp 到 1。
 */
export function buildQuickDiffChanges(lines: FileDiffLine[]): QuickDiffChange[] {
  const result: QuickDiffChange[] = []
  const seenRemoved = new Set<number>()
  for (const line of lines) {
    const lineNumber = Math.max(1, line.lineNumber ?? 1)
    if (line.type === 'removed') {
      if (seenRemoved.has(lineNumber)) continue
      seenRemoved.add(lineNumber)
    }
    result.push({ id: `${line.type}:${lineNumber}`, lineNumber, type: line.type })
  }
  return result
}

/** Monaco lines decorations 类名，对应 index.css 中的 .dirty-diff-* 规则（与 VSCode quickDiffDecorator 一致）。 */
export function getGlyphClassName(type: FileDiffLine['type']): string {
  const kind = type === 'added' ? 'added' : type === 'modified' ? 'modified' : 'deleted'
  return `dirty-diff-glyph dirty-diff-${kind} primary`
}

/** gutter 标记的 hover tooltip 文案。 */
export function getGutterTooltip(type: FileDiffLine['type']): string {
  if (type === 'added') return '新增行'
  if (type === 'modified') return '修改行'
  return '删除行'
}

/** 按变更类型取对应主题下的主色（peek 边框、标记等共用）。 */
export function getGutterColor(type: FileDiffLine['type'], theme: 'dark' | 'light'): string {
  const palette = GUTTER_COLORS[theme]
  if (type === 'added') return palette.added
  if (type === 'modified') return palette.modified
  return palette.deleted
}
