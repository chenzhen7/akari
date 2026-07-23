/**
 * 全局快捷键定义（VS Code 风格）。
 *
 * 单一数据源：useGlobalShortcuts 用它匹配并分发，ShortcutsHelpDialog 与侧边栏
 * 用它渲染提示。新增快捷键只需在 SHORTCUTS 中追加一条。
 *
 * 终端（xterm）会吞键盘输入，因此快捷键统一在 window 捕获阶段拦截
 * （见 useGlobalShortcuts），匹配到即 preventDefault + stopPropagation，
 * 阻止按键继续传到终端的 textarea。
 */

export type ShortcutId =
  | 'toggle-left'
  | 'toggle-right'
  | 'new-session'
  | 'new-terminal'
  | 'close-tab'
  | 'command-center'
  | 'kanban'
  | 'next-tab'
  | 'prev-tab'
  | 'settings'
  | 'help'

export interface KeyCombo {
  /** 主键，按 KeyboardEvent.key 取值（字母小写，特殊键如 'Tab' / ',' / '/'） */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export interface ShortcutDef {
  id: ShortcutId
  combo: KeyCombo
  /** 分组标题，用于帮助弹窗归类 */
  group: string
  description: string
}

/** Ctrl 在 mac 上等价于 ⌘（Cmd），匹配时两者通用 */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export const SHORTCUTS: ShortcutDef[] = [
  // ── 布局 ──
  { id: 'toggle-left', combo: { key: 'b', ctrl: true }, group: '布局', description: '切换左侧会话列表' },
  { id: 'toggle-right', combo: { key: 'b', ctrl: true, alt: true }, group: '布局', description: '切换右侧详情面板' },
  // ── 会话与终端 ──
  { id: 'new-session', combo: { key: 'n', ctrl: true }, group: '会话与终端', description: '新建会话' },
  { id: 'new-terminal', combo: { key: 't', ctrl: true }, group: '会话与终端', description: '当前会话新建终端' },
  // ── 标签 ──
  { id: 'close-tab', combo: { key: 'w', ctrl: true }, group: '标签', description: '关闭当前标签' },
  { id: 'next-tab', combo: { key: 'Tab', ctrl: true }, group: '标签', description: '下一个标签' },
  { id: 'prev-tab', combo: { key: 'Tab', ctrl: true, shift: true }, group: '标签', description: '上一个标签' },
  // ── 视图与面板 ──
  { id: 'command-center', combo: { key: 'k', ctrl: true }, group: '视图与面板', description: '打开指挥中心' },
  { id: 'kanban', combo: { key: 'k', ctrl: true, shift: true }, group: '视图与面板', description: '切换看板视图' },
  { id: 'settings', combo: { key: ',', ctrl: true }, group: '视图与面板', description: '打开设置' },
  { id: 'help', combo: { key: '/', ctrl: true }, group: '视图与面板', description: '显示快捷键帮助' },
]

/** Ctrl+1~9 跳转会话：单独处理（不进 SHORTCUTS），帮助弹窗里用这条说明展示 */
export const GOTO_SESSION_HELP: { label: string; group: string; description: string } = {
  label: formatComboLabel({ key: '1~9', ctrl: true }),
  group: '会话与终端',
  description: '跳转到第 N 个会话',
}

/** 判断 KeyboardEvent 是否命中某个组合键（修饰键需精确匹配，Ctrl/⌘ 通用） */
export function matchCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  const wantCtrl = combo.ctrl ?? false
  const wantShift = combo.shift ?? false
  const wantAlt = combo.alt ?? false

  if ((e.ctrlKey || e.metaKey) !== wantCtrl) return false
  if (e.shiftKey !== wantShift) return false
  if (e.altKey !== wantAlt) return false

  const key = e.key.toLowerCase()
  return key === combo.key.toLowerCase()
}

/** 把组合键格式化为展示文本，如 'Ctrl+Shift+K'（mac 用 ⌘/⌥/⇧） */
export function formatComboLabel(combo: KeyCombo): string {
  const parts: string[] = []
  if (combo.ctrl) parts.push(isMac ? '⌘' : 'Ctrl')
  if (combo.shift) parts.push(isMac ? '⇧' : 'Shift')
  if (combo.alt) parts.push(isMac ? '⌥' : 'Alt')
  const key = combo.key === 'Tab' ? 'Tab' : combo.key.length === 1 ? combo.key.toUpperCase() : combo.key
  parts.push(key)
  return parts.join(isMac ? '' : '+')
}

/** 取某个 id 的展示文本，供按钮提示复用 */
export function shortcutLabel(id: ShortcutId): string {
  const def = SHORTCUTS.find(s => s.id === id)
  return def ? formatComboLabel(def.combo) : ''
}

/**
 * 是否处于「正在输入」的目标元素（输入框/文本域/可编辑区），此时不拦截快捷键。
 * 终端（.xterm 内的 textarea）例外 —— 终端里仍需要全局快捷键生效。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.xterm')) return false // 终端：放行快捷键
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
