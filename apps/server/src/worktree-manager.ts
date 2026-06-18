import { execa } from 'execa'
import { watch, type FSWatcher } from 'chokidar'
import { mkdir, symlink, rm, access, constants, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve, dirname, basename, sep, relative } from 'node:path'
import type { GitDiff, DiffFile, GitCommit, GitBranch, GitLogResponse, FileNode, FileDiffLine } from '@akari/shared-types'

export class WorktreeManager {
  private readonly repoRoot: string
  private readonly workspacePath: string
  private readonly workspaceOffset: string
  private readonly worktreeBaseDir: string
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(repoRoot: string, workspacePath: string, worktreeBaseDir: string) {
    this.repoRoot = resolve(repoRoot)
    this.workspacePath = resolve(workspacePath)
    this.workspaceOffset = relative(this.repoRoot, this.workspacePath).replace(/\\/g, '/')
    this.worktreeBaseDir = resolve(worktreeBaseDir)
  }

  private isAgentWorktree(cwd: string): boolean {
    return resolve(cwd).startsWith(this.worktreeBaseDir + sep)
  }

  private async resolveFilePath(filePath: string, cwd: string): Promise<string> {
    const normalized = filePath.replace(/\\/g, '/')
    if (this.isAgentWorktree(cwd)) {
      return join(cwd, normalized)
    }
    const offset = this.workspaceOffset
    if (offset && (normalized === offset || normalized.startsWith(offset + '/'))) {
      return join(this.repoRoot, normalized)
    }
    // Prefer workspace-relative if the file exists there.
    const workspaceAbsolute = join(this.workspacePath, normalized)
    try {
      await access(workspaceAbsolute, constants.F_OK)
      return workspaceAbsolute
    } catch {
      return join(this.repoRoot, normalized)
    }
  }

  async createWorktree(
    sessionId: string,
    baseBranch = 'main',
  ): Promise<{ branchName: string; worktreePath: string; resolvedBase: string }> {
    const branchName = `agent/${sessionId.slice(0, 8)}`
    const worktreePath = this.getWorktreePath(sessionId)

    await mkdir(this.worktreeBaseDir, { recursive: true })

    // Resolve base branch — fall back to current HEAD if requested branch doesn't exist
    let resolvedBase = baseBranch
    try {
      await this.git(['rev-parse', '--verify', baseBranch])
    } catch {
      resolvedBase = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    }

    await this.git(['worktree', 'add', '-b', branchName, worktreePath, resolvedBase])
    await this.linkNodeModules(worktreePath)

    return { branchName, worktreePath, resolvedBase }
  }

  async removeWorktree(sessionId: string, worktreePath: string, branchName?: string): Promise<void> {
    const watcher = this.watchers.get(sessionId)
    if (watcher) {
      await watcher.close()
      this.watchers.delete(sessionId)
    }
    try {
      await this.git(['worktree', 'remove', '--force', worktreePath])
    } catch {
      // worktree not registered in git — proceed to rm the directory directly
    }
    // Always attempt to remove the physical directory, even if git worktree remove succeeded
    try {
      await rm(worktreePath, { recursive: true, force: true })
    } catch {
      // directory may not exist or be locked — non-fatal
    }
    try {
      await this.git(['worktree', 'prune'])
    } catch {
      // prune failure is non-fatal
    }
    if (branchName) {
      try {
        await this.git(['branch', '-D', branchName])
      } catch {
        // branch may already be deleted — non-fatal
      }
    }
  }

  async getCurrentBranch(cwd = this.repoRoot): Promise<string> {
    try {
      const result = await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
      return result.trim()
    } catch {
      return 'main'
    }
  }

  async getDiff(sessionId: string, baseBranch: string, cwd?: string): Promise<GitDiff> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    try {
      // Use merge-base so the diff only reflects agent branch changes,
      // not new commits that may have landed on baseBranch since the worktree was created.
      const mergeBase = (await this.git(['merge-base', 'HEAD', baseBranch], worktreePath).catch(() => '')).trim()
      const baseRef = mergeBase || baseBranch

      const [stat, full, nameStatus, numStat] = await Promise.all([
        this.git(['diff', '--stat', baseRef], worktreePath),
        this.git(['diff', baseRef], worktreePath),
        this.git(['diff', '--name-status', baseRef], worktreePath),
        this.git(['diff', '--numstat', baseRef], worktreePath),
      ])

      const numStatMap = parseNumStat(numStat)

      // git diff only covers tracked files; also capture untracked files
      const gitCwd = this.isAgentWorktree(worktreePath) ? worktreePath : this.repoRoot
      const untrackedRaw = await this.git(['ls-files', '--others', '--exclude-standard', '--full-name'], gitCwd).catch(() => '')
      const untrackedFiles = untrackedRaw.trim() ? untrackedRaw.trim().split('\n').filter(Boolean) : []

      let extraDiff = ''
      const extraFiles: DiffFile[] = []
      for (const file of untrackedFiles) {
        // git diff --no-index exits with code 1 when differences exist (normal, not an error)
        const fileDiff = await execa('git', ['-c', 'core.quotepath=false', 'diff', '--no-index', '--', '/dev/null', file], { cwd: gitCwd })
          .then(r => r.stdout)
          .catch((e: unknown) => {
            const err = e as { exitCode?: number; stdout?: string }
            return err.exitCode === 1 ? (err.stdout ?? '') : ''
          })
        if (fileDiff) {
          extraDiff += fileDiff + '\n'
          const added = fileDiff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length
          extraFiles.push({ path: file, status: 'A', additions: added, deletions: 0 })
        }
      }

      const trackedFiles = parseFileStatus(nameStatus).map(f => ({
        ...f,
        additions: numStatMap.get(f.path)?.additions ?? 0,
        deletions: numStatMap.get(f.path)?.deletions ?? 0,
      }))

      return {
        stat,
        fullDiff: full + extraDiff,
        files: [...trackedFiles, ...extraFiles],
        summary: parseStat(stat),
      }
    } catch {
      return { stat: '', fullDiff: '', files: [], summary: { additions: 0, deletions: 0, files: 0 } }
    }
  }

  async getFileDiffContent(worktreePath: string, baseBranch: string, filePath: string): Promise<{ original: string; modified: string }> {
    const gitCwd = this.isAgentWorktree(worktreePath) ? worktreePath : this.repoRoot
    const mergeBase = await execa('git', ['-c', 'core.quotepath=false', 'merge-base', 'HEAD', baseBranch], { cwd: gitCwd })
      .then(r => r.stdout.trim())
      .catch(() => '')
    const baseRef = mergeBase || baseBranch
    const original = await execa('git', ['-c', 'core.quotepath=false', 'show', `${baseRef}:${filePath}`], { cwd: gitCwd })
      .then(r => r.stdout)
      .catch(() => '')
    const absolutePath = await this.resolveFilePath(filePath, worktreePath)
    const modified = await readFile(absolutePath, 'utf8').catch(() => '')
    return { original, modified }
  }

  async getFileDiffLines(worktreePath: string, baseBranch: string, filePath: string): Promise<FileDiffLine[]> {
    const gitCwd = this.isAgentWorktree(worktreePath) ? worktreePath : this.repoRoot
    const mergeBase = await execa('git', ['-c', 'core.quotepath=false', 'merge-base', 'HEAD', baseBranch], { cwd: gitCwd })
      .then(r => r.stdout.trim())
      .catch(() => '')
    const baseRef = mergeBase || baseBranch

    // For untracked (new) files, use git diff --no-index against /dev/null
    const isUntracked = await execa('git', ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '--full-name'], { cwd: gitCwd })
      .then(r => r.stdout.split('\n').includes(filePath))
      .catch(() => false)

    let diffOutput: string
    if (isUntracked) {
      diffOutput = await execa('git', ['-c', 'core.quotepath=false', 'diff', '--no-index', '--unified=0', '--', '/dev/null', filePath], { cwd: gitCwd })
        .then(r => r.stdout)
        .catch((e: unknown) => {
          const err = e as { exitCode?: number; stdout?: string }
          return err.exitCode === 1 ? (err.stdout ?? '') : ''
        })
    } else {
      diffOutput = await execa('git', ['-c', 'core.quotepath=false', 'diff', '--unified=0', baseRef, '--', filePath], { cwd: gitCwd })
        .then(r => r.stdout)
        .catch(() => '')
    }

    if (!diffOutput) return []
    return parseDiffLines(diffOutput)
  }

  watchDiff(sessionId: string, baseBranch: string, callback: (diff: GitDiff) => void, watchPath?: string, cwd?: string): FSWatcher {
    const resolvedPath = watchPath ?? this.getWorktreePath(sessionId)
    const watcher = watch(resolvedPath, {
      ignored: /(node_modules|\.git)/,
      persistent: true,
      ignoreInitial: true,
    })

    let debounce: ReturnType<typeof setTimeout> | null = null
    const trigger = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        void this.getDiff(sessionId, baseBranch, cwd).then(callback)
      }, 500)
    }

    watcher.on('add', trigger).on('change', trigger).on('unlink', trigger)
    this.watchers.set(sessionId, watcher)

    // Push initial diff immediately so the client sees the starting state.
    void this.getDiff(sessionId, baseBranch, cwd).then(callback)

    return watcher
  }

  async mergeToBase(
    worktreePath: string,
    branchName: string,
    baseBranch: string,
    strategy: 'squash' | 'merge' | 'rebase' = 'squash',
  ): Promise<void> {
    // worktreePath 已经 checkout 在 baseBranch（agent 分支）上，直接在该 worktree 内合并即可
    if (strategy === 'squash') {
      await this.git(['merge', '--squash', branchName], worktreePath)
      await this.git(['commit', '-m', `chore: squash merge ${branchName}`], worktreePath)
    } else if (strategy === 'merge') {
      await this.git(['merge', '--no-ff', '-m', `Merge ${branchName}`, branchName], worktreePath)
    } else {
      await this.git(['rebase', branchName], worktreePath)
    }
  }

  async updateFromBase(sessionId: string, baseBranch: string, worktreePath: string): Promise<void> {
    await this.git(['merge', '--no-ff', '-m', `Merge ${baseBranch} into current branch`, baseBranch], worktreePath)
  }

  async getGitLog(sessionId: string, limit = 100, offset = 0, cwd?: string, branch?: string): Promise<GitLogResponse> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    try {
      const sep = '||'
      const fmt = `%H${sep}%h${sep}%s${sep}%an${sep}%ae${sep}%aI${sep}%P${sep}%D`
      const logArgs = branch
        ? ['log', branch, '--topo-order', `--skip=${offset}`, `--max-count=${limit}`, `--format=${fmt}`]
        : ['log', '--all', '--topo-order', `--skip=${offset}`, `--max-count=${limit}`, `--format=${fmt}`]
      const raw = await this.git(logArgs, worktreePath)
      const commits: GitCommit[] = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split(sep)
          const hash = parts[0] ?? ''
          const shortHash = parts[1] ?? ''
          const message = parts[2] ?? ''
          const author = parts[3] ?? ''
          const email = parts[4] ?? ''
          const date = parts[5] ?? ''
          const parents = (parts[6] ?? '').trim() ? (parts[6] ?? '').trim().split(' ') : []
          const decorations = parts[7] ?? ''
          const refs = decorations
            .split(',')
            .map(r => r.trim())
            .filter(r => r && r !== 'HEAD')
            .map(r => r.replace(/^HEAD -> /, ''))
          return { hash, shortHash, message, author, email, date, parents, refs }
        })

      const head = (await this.git(['rev-parse', 'HEAD'], worktreePath).catch(() => '')).trim()
      const branches = await this.getGitBranches(sessionId, worktreePath)
      return { commits, branches, head }
    } catch {
      return { commits: [], branches: [], head: '' }
    }
  }

  async getGitBranches(sessionId: string, cwd?: string): Promise<GitBranch[]> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    try {
      const raw = await this.git(['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(HEAD)'], worktreePath)
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|')
          const name = (parts[0] ?? '').trim()
          const commit = (parts[1] ?? '').trim()
          const isCurrent = (parts[2] ?? '').trim() === '*'
          const isRemote = name.startsWith('remotes/') || name.startsWith('origin/')
          return { name: name.replace(/^remotes\//, ''), commit, isCurrent, isRemote }
        })
        .filter(b => b.name && b.name !== 'HEAD')
    } catch {
      return []
    }
  }

  async getRepoBranches(): Promise<{ name: string; isCurrent: boolean }[]> {
    try {
      const raw = await this.git(['branch', '--format=%(refname:short)|%(HEAD)'])
      return raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const parts = line.split('|')
          const name = (parts[0] ?? '').trim()
          const isCurrent = (parts[1] ?? '').trim() === '*'
          return { name, isCurrent }
        })
        .filter(b => b.name)
    } catch {
      return []
    }
  }

  async commitAll(sessionId: string, message: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    await this.git(['add', '-A'], worktreePath)
    await this.git(['commit', '-m', message], worktreePath)
  }

  async discardAll(sessionId: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    await this.git(['checkout', '--', '.'], worktreePath)
    await this.git(['clean', '-fd'], worktreePath)
  }

  async checkoutBranch(sessionId: string, branch: string, createNew = false, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    if (createNew) {
      await this.git(['checkout', '-b', branch], worktreePath)
    } else {
      await this.git(['checkout', branch], worktreePath)
    }
  }

  async discardFile(sessionId: string, filePath: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const absolutePath = await this.resolveFilePath(filePath, worktreePath)
    this.assertPathInWorktree(worktreePath, absolutePath)
    const gitCwd = this.isAgentWorktree(worktreePath) ? worktreePath : this.repoRoot
    await this.git(['checkout', '--', filePath], gitCwd)
    await this.git(['clean', '-fd', '--', filePath], gitCwd)
  }

  private assertPathInWorktree(worktreePath: string, filePath: string): string {
    const resolvedFile = resolve(filePath)
    const allowedBase = this.isAgentWorktree(worktreePath) ? resolve(worktreePath) : this.repoRoot
    const isInside = resolvedFile === allowedBase || resolvedFile.startsWith(allowedBase + sep)
    if (!isInside) {
      throw new Error(`invalid file path: ${filePath}`)
    }
    return resolvedFile
  }

  async listFiles(sessionId: string, relativePath: string, cwd?: string): Promise<FileNode[]> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const targetPath = join(worktreePath, relativePath)

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      const filtered = entries.filter(entry => {
        if (entry.name === 'node_modules') return false
        if (entry.name === '.git') return false
        if (entry.name === '.agent-worktrees') return false
        return true
      })

      const nodes: FileNode[] = filtered.map(entry => ({
        name: entry.name,
        path: join(relativePath, entry.name).replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
      }))

      // Sort: directories first, then files, both alphabetically
      nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })

      return nodes
    } catch {
      // Worktree not ready or directory doesn't exist — return empty list
      return []
    }
  }

  async readFileContent(sessionId: string, filePath: string, cwd?: string): Promise<string> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const fullPath = await this.resolveFilePath(filePath, worktreePath)

    const stats = await access(fullPath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
    if (!stats) throw new Error(`File not found: ${filePath}`)

    const content = await readFile(fullPath, 'utf8')
    return content
  }

  async writeFileContent(sessionId: string, filePath: string, content: string, cwd?: string): Promise<void> {
    const worktreePath = cwd ?? this.getWorktreePath(sessionId)
    const fullPath = await this.resolveWritePath(filePath, worktreePath)

    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }

  private async resolveWritePath(filePath: string, cwd: string): Promise<string> {
    const normalized = filePath.replace(/\\/g, '/')
    if (this.isAgentWorktree(cwd)) {
      return join(cwd, normalized)
    }
    const offset = this.workspaceOffset
    if (offset && (normalized === offset || normalized.startsWith(offset + '/'))) {
      return join(this.repoRoot, normalized)
    }
    return join(this.workspacePath, normalized)
  }

  getWorktreePath(sessionId: string): string {
    const repoSlug = basename(this.repoRoot)
    return join(this.worktreeBaseDir, repoSlug, sessionId)
  }

  private async git(args: string[], cwd = this.repoRoot): Promise<string> {
    const result = await execa('git', ['-c', 'core.quotepath=false', ...args], { cwd })
    return result.stdout
  }

  private async linkNodeModules(worktreePath: string): Promise<void> {
    const src = join(this.repoRoot, 'node_modules')
    const dst = join(worktreePath, 'node_modules')
    try {
      await access(src, constants.F_OK)
      await access(dst, constants.F_OK).catch(async () => {
        await symlink(src, dst, 'junction')
      })
    } catch {
      // src doesn't exist, skip
    }
  }
}

function parseFileStatus(output: string): DiffFile[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .flatMap(line => {
      const parts = line.split('\t')
      if (parts.length < 2) return []
      const char = parts[0].charAt(0)
      const validStatuses = new Set(['A', 'M', 'D', 'R'])
      const status = validStatuses.has(char) ? (char as DiffFile['status']) : 'M'
      const path = parts[1] ?? ''
      if (!path) return []
      return [{ path, status, additions: 0, deletions: 0 }]
    })
}

function parseNumStat(output: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>()
  if (!output.trim()) return map
  for (const line of output.trim().split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const additions = parseInt(parts[0] ?? '0') || 0
    const deletions = parseInt(parts[1] ?? '0') || 0
    const path = parts.slice(2).join('\t')
    if (path) map.set(path, { additions, deletions })
  }
  return map
}

function parseStat(stat: string): { additions: number; deletions: number; files: number } {
  if (!stat.trim()) return { additions: 0, deletions: 0, files: 0 }
  return {
    files: parseInt(stat.match(/(\d+) file/)?.[1] ?? '0'),
    additions: parseInt(stat.match(/(\d+) insertion/)?.[1] ?? '0'),
    deletions: parseInt(stat.match(/(\d+) deletion/)?.[1] ?? '0'),
  }
}

function parseDiffLines(diffOutput: string): FileDiffLine[] {
  const lines: FileDiffLine[] = []
  const diffLines = diffOutput.split('\n')
  let i = 0

  while (i < diffLines.length) {
    const line = diffLines[i]
    if (!line.startsWith('@@')) {
      i++
      continue
    }

    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!match) {
      i++
      continue
    }

    const oldStart = parseInt(match[1]!)
    const oldCount = parseInt(match[2] ?? '1')
    const newStart = parseInt(match[3]!)
    const newCount = parseInt(match[4] ?? '1')

    let oldLine = oldStart
    let newLine = newStart
    i++

    // Collect all lines in this hunk
    const hunkMinusLines: number[] = [] // old line numbers that were deleted
    const hunkPlusLines: number[] = []  // new line numbers that were added

    while (i < diffLines.length && !diffLines[i]!.startsWith('@@') && !diffLines[i]!.startsWith('diff --git')) {
      const dline = diffLines[i]!
      if (dline.startsWith(' ')) {
        oldLine++
        newLine++
      } else if (dline.startsWith('+')) {
        hunkPlusLines.push(newLine)
        newLine++
      } else if (dline.startsWith('-')) {
        hunkMinusLines.push(oldLine)
        oldLine++
      }
      i++
    }

    // Determine types
    if (hunkMinusLines.length > 0 && hunkPlusLines.length > 0) {
      // Mixed: some are modifications, remaining are pure additions/deletions
      const pairCount = Math.min(hunkMinusLines.length, hunkPlusLines.length)
      for (let j = 0; j < pairCount; j++) {
        lines.push({ type: 'modified', lineNumber: hunkPlusLines[j]! })
      }
      for (let j = pairCount; j < hunkPlusLines.length; j++) {
        lines.push({ type: 'added', lineNumber: hunkPlusLines[j]! })
      }
      // Remaining deletions → mark removed at the position of first plus line (or newStart if no plus)
      if (hunkPlusLines.length > 0) {
        for (let j = pairCount; j < hunkMinusLines.length; j++) {
          lines.push({ type: 'removed', lineNumber: hunkPlusLines[0]! })
        }
      } else {
        // Pure deletion hunk → mark removed at newStart
        for (let j = 0; j < hunkMinusLines.length; j++) {
          lines.push({ type: 'removed', lineNumber: newStart })
        }
      }
    } else if (hunkPlusLines.length > 0) {
      // Pure additions
      for (const ln of hunkPlusLines) {
        lines.push({ type: 'added', lineNumber: ln })
      }
    } else if (hunkMinusLines.length > 0) {
      // Pure deletions
      for (let j = 0; j < hunkMinusLines.length; j++) {
        lines.push({ type: 'removed', lineNumber: newStart })
      }
    }
  }

  return lines
}
