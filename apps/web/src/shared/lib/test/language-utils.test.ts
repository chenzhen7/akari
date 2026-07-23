import { describe, it, expect } from 'vitest'
import { detectLanguage } from '../language-utils'

describe('detectLanguage', () => {
  it('detects TypeScript and TSX', () => {
    expect(detectLanguage('component.tsx')).toBe('typescript')
    expect(detectLanguage('lib/util.ts')).toBe('typescript')
  })

  it('detects JavaScript and JSX', () => {
    expect(detectLanguage('app.jsx')).toBe('javascript')
    expect(detectLanguage('index.js')).toBe('javascript')
  })

  it('detects Python', () => {
    expect(detectLanguage('script.py')).toBe('python')
  })

  it('detects Rust', () => {
    expect(detectLanguage('main.rs')).toBe('rust')
  })

  it('detects Go', () => {
    expect(detectLanguage('server.go')).toBe('go')
  })

  it('detects Markdown', () => {
    expect(detectLanguage('README.md')).toBe('markdown')
  })

  it('detects JSON', () => {
    expect(detectLanguage('package.json')).toBe('json')
  })

  it('falls back to plaintext for unknown extensions', () => {
    expect(detectLanguage('file.unknown')).toBe('plaintext')
  })

  it('falls back to plaintext when no extension', () => {
    expect(detectLanguage('Makefile')).toBe('plaintext')
  })
})
