import { mkdir, access, constants, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { FileNode } from '@akari/shared-types'
import { perfLog, perfNow } from '../../perf-log.js'

export interface IFileSystemService {
  listFiles(cwd: string, relativePath: string): Promise<FileNode[]>
  readFileContent(cwd: string, filePath: string): Promise<string>
  writeFileContent(cwd: string, filePath: string, content: string): Promise<void>
  resolveFilePath(filePath: string, cwd: string): Promise<string>
  resolveWritePath(filePath: string, cwd: string): string
  assertPathInWorktree(worktreePath: string, filePath: string): string
  getWorktreePath(sessionId: string): string
}

export class FileSystemService implements IFileSystemService {
  constructor(
    private readonly repoRoot: string,
    private readonly workspacePath: string,
    private readonly worktreeBaseDir: string,
  ) {}

  private get workspaceOffset(): string {
    return relative(this.repoRoot, this.workspacePath).replace(/\\/g, '/')
  }

  private isAgentWorktree(cwd: string): boolean {
    return resolve(cwd).startsWith(resolve(this.worktreeBaseDir) + sep)
  }

  async resolveFilePath(filePath: string, cwd: string): Promise<string> {
    const t0 = perfNow()
    try {
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
    } finally {
      perfLog(`[fs] resolveFilePath ${filePath} @ ${cwd}`, t0)
    }
  }

  resolveWritePath(filePath: string, cwd: string): string {
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

  assertPathInWorktree(worktreePath: string, filePath: string): string {
    const resolvedFile = resolve(filePath)
    const allowedBase = this.isAgentWorktree(worktreePath) ? resolve(worktreePath) : resolve(this.repoRoot)
    const isInside = resolvedFile === allowedBase || resolvedFile.startsWith(allowedBase + sep)
    if (!isInside) {
      throw new Error(`invalid file path: ${filePath}`)
    }
    return resolvedFile
  }

  async listFiles(cwd: string, relativePath: string): Promise<FileNode[]> {
    const t0 = perfNow()
    const targetPath = join(cwd, relativePath)

    try {
      const tRead = perfNow()
      const entries = await readdir(targetPath, { withFileTypes: true })
      perfLog(`[fs] readdir ${relativePath || '(root)'} @ ${cwd}`, tRead)

      const filtered = entries.filter((entry) => {
        if (entry.name === 'node_modules') return false
        if (entry.name === '.git') return false
        if (entry.name === '.agent-worktrees') return false
        return true
      })

      const nodes: FileNode[] = filtered.map((entry) => ({
        name: entry.name,
        path: join(relativePath, entry.name).replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
      }))

      nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })

      return nodes
    } catch {
      // Worktree not ready or directory doesn't exist — return empty list
      return []
    } finally {
      perfLog(`[fs] listFiles ${relativePath || '(root)'} @ ${cwd}`, t0)
    }
  }

  async readFileContent(cwd: string, filePath: string): Promise<string> {
    const t0 = perfNow()
    try {
      const fullPath = await this.resolveFilePath(filePath, cwd)

      const tAccess = perfNow()
      const stats = await access(fullPath, constants.F_OK)
        .then(() => true)
        .catch(() => false)
      perfLog(`[fs] access ${filePath}`, tAccess)

      if (!stats) throw new Error(`File not found: ${filePath}`)

      const tRead = perfNow()
      const content = await readFile(fullPath, 'utf8')
      perfLog(`[fs] readFile ${filePath}`, tRead)
      return content
    } finally {
      perfLog(`[fs] readFileContent ${filePath}（总耗时）`, t0)
    }
  }

  async writeFileContent(cwd: string, filePath: string, content: string): Promise<void> {
    const fullPath = this.resolveWritePath(filePath, cwd)

    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }

  getWorktreePath(sessionId: string): string {
    const repoSlug = basename(this.repoRoot)
    return join(this.worktreeBaseDir, repoSlug, sessionId)
  }
}
