import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { resizeMutex } from '@/shared/lib/ptyResizeMutex'

export interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  unsubscribeData: () => void
  unsubscribeResized: () => void
  detachImeAnchor: () => void
  disposeClipboardHandlers?: () => void
}

/** Module-level registry: keeps Terminal instances alive across tab switches. */
export const terminalInstances = new Map<string, TerminalEntry>()

/**
 * Read the last `maxLines` non-empty lines from the currently visible xterm viewport.
 * Returns [] if the terminal instance hasn't been created yet.
 */
export function getTerminalViewportLines(terminalId: string, maxLines = 5): string[] {
  const entry = terminalInstances.get(terminalId)
  if (!entry) return []
  const { term } = entry
  const buf = term.buffer.active
  const viewportY = buf.viewportY
  const viewportEnd = viewportY + term.rows - 1
  const result: string[] = []
  for (let row = viewportEnd; row >= viewportY && result.length < maxLines; row--) {
    const line = buf.getLine(row)
    if (!line) continue
    const text = line.translateToString(true).trimEnd()
    result.unshift(text)
  }
  return result
}

/** Call when a terminal tab is closed to free xterm resources. */
export function destroyTerminalInstance(terminalId: string): void {
  const entry = terminalInstances.get(terminalId)
  if (entry) {
    entry.disposeClipboardHandlers?.()
    entry.detachImeAnchor()
    entry.unsubscribeData()
    entry.unsubscribeResized()
    entry.term.dispose()
    terminalInstances.delete(terminalId)
  }
  resizeMutex.release(terminalId) // drain any residual buffer
}
