import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ignore from 'ignore'

export interface GitignoreFilter {
  /** Returns true if the given repo-relative POSIX path should be ignored. */
  ignores(relativePath: string): boolean
}

/**
 * Load the repository's `.gitignore` (if present) and return a filter.
 *
 * The filter expects repo-relative POSIX paths, e.g. "src/foo.ts" or
 * "node_modules/lodash/index.js". It follows standard gitignore semantics
 * including negation patterns (`!`), directory markers (`/`), and comments.
 */
export function loadGitignoreFilter(repoPath: string): GitignoreFilter {
  const ig = ignore()
  try {
    const content = readFileSync(join(repoPath, '.gitignore'), 'utf8')
    ig.add(content)
  } catch {
    // .gitignore may not exist — that's fine, the filter will just match nothing.
  }

  return {
    ignores: (relativePath: string) => ig.ignores(relativePath),
  }
}
