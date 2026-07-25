import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ignore from 'ignore'

export interface GitignoreFilter {
  /** Returns true if the given repo-relative POSIX path should be ignored. */
  ignores(relativePath: string): boolean
}

function findGitRoot(startPath: string): string | null {
  let current = resolve(startPath)
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/**
 * Load `.gitignore` files for a repository path.
 *
 * The supplied `repoPath` may be a subdirectory of the actual git root (e.g.
 * a Maven module inside a multi-module project). We walk up to the git root
 * and load `.gitignore` from there, plus any `.gitignore` at intermediate
 * levels, so chokidar exclusions match what git itself would ignore.
 *
 * The filter expects paths relative to `repoPath` using POSIX separators,
 * e.g. "src/main/java/Foo.java" or "target/classes/Foo.class".
 */
export function loadGitignoreFilter(repoPath: string): GitignoreFilter {
  const ig = ignore()
  const gitRoot = findGitRoot(repoPath)
  const resolvedRepo = resolve(repoPath)

  let current = resolvedRepo
  while (true) {
    try {
      const content = readFileSync(join(current, '.gitignore'), 'utf8')
      ig.add(content)
    } catch {
      // .gitignore may not exist at this level — that's fine.
    }

    if (gitRoot && current === gitRoot) break
    if (!gitRoot && existsSync(join(current, '.git'))) break

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return {
    ignores: (relativePath: string) => ig.ignores(relativePath),
  }
}
