import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('shortcuts on Windows', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('formats Windows label', async () => {
    vi.resetModules()
    const { formatComboLabel } = await import('./shortcuts')
    expect(formatComboLabel({ key: 'k', ctrl: true, shift: true })).toBe('Ctrl+Shift+K')
  })

  it('returns label for known shortcut', async () => {
    vi.resetModules()
    const { shortcutLabel } = await import('./shortcuts')
    expect(shortcutLabel('new-session')).toBe('Ctrl+N')
  })
})

describe('shortcuts on macOS', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('formats macOS label with symbols', async () => {
    vi.resetModules()
    const { formatComboLabel } = await import('./shortcuts')
    expect(formatComboLabel({ key: 'k', ctrl: true, shift: true })).toBe('⌘⇧K')
  })
})

describe('matchCombo', () => {
  it('matches simple ctrl key', async () => {
    const { matchCombo } = await import('./shortcuts')
    const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
    expect(matchCombo(e, { key: 'k', ctrl: true })).toBe(true)
  })

  it('treats meta as ctrl', async () => {
    const { matchCombo } = await import('./shortcuts')
    const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true })
    expect(matchCombo(e, { key: 'k', ctrl: true })).toBe(true)
  })

  it('fails when modifier mismatch', async () => {
    const { matchCombo } = await import('./shortcuts')
    const e = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
    expect(matchCombo(e, { key: 'k' })).toBe(false)
  })

  it('is case-insensitive for letter keys', async () => {
    const { matchCombo } = await import('./shortcuts')
    const e = new KeyboardEvent('keydown', { key: 'K', ctrlKey: true })
    expect(matchCombo(e, { key: 'k', ctrl: true })).toBe(true)
  })

  it('matches shift modifier using mock event', async () => {
    const { matchCombo } = await import('./shortcuts')
    const e = {
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      key: 'Tab',
    } as KeyboardEvent
    expect(matchCombo(e, { key: 'Tab', ctrl: true, shift: true })).toBe(true)
  })

  it('matches alt modifier', async () => {
    const { matchCombo } = await import('./shortcuts')
    const e = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, altKey: true })
    expect(matchCombo(e, { key: 'b', ctrl: true, alt: true })).toBe(true)
  })
})

describe('isTypingTarget', () => {
  it('returns true for input elements', async () => {
    const { isTypingTarget } = await import('./shortcuts')
    const input = document.createElement('input')
    expect(isTypingTarget(input)).toBe(true)
  })

  it('returns true for contenteditable', async () => {
    const { isTypingTarget } = await import('./shortcuts')
    const div = document.createElement('div')
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true })
    expect(isTypingTarget(div)).toBe(true)
  })

  it('returns false for xterm textarea', async () => {
    const { isTypingTarget } = await import('./shortcuts')
    const xterm = document.createElement('div')
    xterm.className = 'xterm'
    const textarea = document.createElement('textarea')
    xterm.appendChild(textarea)
    expect(isTypingTarget(textarea)).toBe(false)
  })

  it('returns false for non-element target', async () => {
    const { isTypingTarget } = await import('./shortcuts')
    expect(isTypingTarget(null)).toBe(false)
  })

  it('returns false for plain div', async () => {
    const { isTypingTarget } = await import('./shortcuts')
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
  })
})

describe('SHORTCUTS', () => {
  it('has unique ids', async () => {
    const { SHORTCUTS } = await import('./shortcuts')
    const ids = SHORTCUTS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
