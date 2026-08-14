import type { DiffHunk, DiffLine, DiffLineType, FileDiffLine } from '@akari/shared-types'

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function parseCount(value: string | undefined): number {
  if (value === undefined) return 1
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? 1 : n
}

function isHunkTerminator(line: string): boolean {
  return line.startsWith('@@') || line.startsWith('diff --git')
}

function isNoNewlineMarker(line: string): boolean {
  return line.startsWith('\\ No newline at end of file')
}

function extractFilePath(section: string): string | null {
  const plusMatch = /^\+\+\+ b\/(.+)$/m.exec(section)
  if (plusMatch?.[1]) return plusMatch[1]
  const plusRawMatch = /^\+\+\+ (.+)$/m.exec(section)
  if (plusRawMatch?.[1] && plusRawMatch[1] !== '/dev/null') {
    return plusRawMatch[1]
  }
  const minusMatch = /^--- a\/(.+)$/m.exec(section)
  if (minusMatch?.[1]) return minusMatch[1]
  return null
}

export function parseDiffHunksByFile(diffOutput: string): Record<string, DiffHunk[]> {
  const result: Record<string, DiffHunk[]> = {}
  if (!diffOutput.trim()) return result

  const sections = diffOutput.split('\ndiff --git ')
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]
    if (!section) continue
    const fullSection = i === 0 ? section : `diff --git ${section}`
    const filePath = extractFilePath(fullSection)
    if (!filePath) continue
    const hunks = parseDiffHunks(fullSection)
    if (hunks.length > 0) {
      result[filePath] = hunks
    }
  }

  return result
}

export function parseDiffHunks(diffOutput: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const lines = diffOutput.split('\n')
  let i = 0
  let hunkIndex = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line || !line.startsWith('@@')) {
      i++
      continue
    }

    const match = HUNK_HEADER_RE.exec(line)
    if (!match) {
      i++
      continue
    }

    const oldStart = parseInt(match[1]!, 10)
    const oldCount = parseCount(match[2])
    const newStart = parseInt(match[3]!, 10)
    const newCount = parseCount(match[4])
    const header = match[5] ?? ''
    i++

    const hunkLines: DiffLine[] = []
    let oldLine = oldStart
    let newLine = newStart
    let additions = 0
    let deletions = 0

    while (i < lines.length) {
      const dline = lines[i]
      if (!dline) {
        i++
        continue
      }
      if (isHunkTerminator(dline)) {
        break
      }
      // `\ No newline at end of file` 是前一行「无结尾换行」的元数据，可能出现在
      // hunk 中间（如末尾 `}` 被改动时），必须跳过并继续，不能当作 hunk 结束
      if (isNoNewlineMarker(dline)) {
        i++
        continue
      }

      const prefix = dline.charAt(0)
      const content = dline.slice(1)

      if (prefix === ' ') {
        hunkLines.push({
          type: 'context' as DiffLineType,
          content,
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        })
        oldLine++
        newLine++
      } else if (prefix === '+') {
        hunkLines.push({
          type: 'added' as DiffLineType,
          content,
          newLineNumber: newLine,
        })
        newLine++
        additions++
      } else if (prefix === '-') {
        hunkLines.push({
          type: 'removed' as DiffLineType,
          content,
          oldLineNumber: oldLine,
        })
        oldLine++
        deletions++
      }
      i++
    }

    hunks.push({
      id: `hunk-${hunkIndex}`,
      header,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: hunkLines,
      additions,
      deletions,
    })
    hunkIndex++
  }

  return hunks
}

export function parseDiffLines(diffOutput: string): FileDiffLine[] {
  const result: FileDiffLine[] = []
  const lines = diffOutput.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line || !line.startsWith('@@')) {
      i++
      continue
    }

    const match = HUNK_HEADER_RE.exec(line)
    if (!match) {
      i++
      continue
    }

    const oldStart = parseInt(match[1]!, 10)
    const newStart = parseInt(match[3]!, 10)
    i++

    const minusLines: number[] = []
    const plusLines: number[] = []

    let oldLine = oldStart
    let newLine = newStart

    while (i < lines.length) {
      const dline = lines[i]
      if (!dline) {
        i++
        continue
      }
      if (isHunkTerminator(dline)) {
        break
      }
      // 同 parseDiffHunks：no-newline 标记是元数据，跳过继续
      if (isNoNewlineMarker(dline)) {
        i++
        continue
      }

      const prefix = dline.charAt(0)
      if (prefix === ' ') {
        oldLine++
        newLine++
      } else if (prefix === '+') {
        plusLines.push(newLine)
        newLine++
      } else if (prefix === '-') {
        minusLines.push(oldLine)
        oldLine++
      }
      i++
    }

    if (minusLines.length > 0 && plusLines.length > 0) {
      const pairCount = Math.min(minusLines.length, plusLines.length)
      for (let j = 0; j < pairCount; j++) {
        result.push({ type: 'modified', lineNumber: plusLines[j]! })
      }
      for (let j = pairCount; j < plusLines.length; j++) {
        result.push({ type: 'added', lineNumber: plusLines[j]! })
      }
      if (plusLines.length > 0) {
        for (let j = pairCount; j < minusLines.length; j++) {
          result.push({ type: 'removed', lineNumber: plusLines[0]! })
        }
      } else {
        for (let j = 0; j < minusLines.length; j++) {
          result.push({ type: 'removed', lineNumber: newStart })
        }
      }
    } else if (plusLines.length > 0) {
      for (const ln of plusLines) {
        result.push({ type: 'added', lineNumber: ln })
      }
    } else if (minusLines.length > 0) {
      for (let j = 0; j < minusLines.length; j++) {
        result.push({ type: 'removed', lineNumber: newStart })
      }
    }
  }

  return result
}
